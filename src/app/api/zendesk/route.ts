import { NextRequest, NextResponse } from 'next/server'

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || 'fenixoutdoorsupport'
const EMAIL = process.env.ZENDESK_EMAIL || ''
const TOKEN = process.env.ZENDESK_API_TOKEN || ''

const NA_BRANDS: Record<string, string> = {
  '360001345039': 'Fjällräven US',
  '10360727124754': 'Fjällräven CA',
  '360001351320': 'Hanwag NA',
  '360001351360': 'Royal Robbins NA',
}
const NA_BRAND_IDS = Object.keys(NA_BRANDS)
const NA_DTC_GROUP_ID = '360003109320'

// The exact Zendesk view that defines your backlog
const DTC_BACKLOG_VIEW_ID = '11310174076050'

const FIELD_NA_CATEGORY = 29839585505938

const CATEGORY_LABELS: Record<string, string> = {
  'na_order': 'Order',
  'na_returns_and_exchanges': 'Returns & Exchanges',
  'na_warranty_repair': 'Warranty & Repair',
  'na_product_and_stock': 'Product & Stock',
  'na_payment': 'Payment',
  'na_technical_issues': 'Technical Issues',
  'na_industry_pro_program': 'Industry Pro',
  'na_pre_loved_program': 'Pre-Loved',
  'na_other': 'Other',
}

function getAuth() {
  return 'Basic ' + Buffer.from(`${EMAIL}/token:${TOKEN}`).toString('base64')
}

async function zdFetch(path: string) {
  const url = `https://${SUBDOMAIN}.zendesk.com${path}`
  const res = await fetch(url, {
    headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json' },
    next: { revalidate: 300 }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Zendesk API ${res.status} on ${path}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function zdSearch(query: string, perPage = 100, page = 1) {
  const url = `https://${SUBDOMAIN}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`
  const res = await fetch(url, {
    headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json' },
    next: { revalidate: 300 }
  })
  if (!res.ok) throw new Error(`Zendesk search ${res.status}`)
  return res.json()
}

function getCustomField(ticket: any, fieldId: number): any {
  const field = ticket.custom_fields?.find((f: any) => f.id === fieldId)
  return field?.value ?? null
}

function parseTicket(t: any) {
  const naCategory = getCustomField(t, FIELD_NA_CATEGORY)
  return {
    id: t.id,
    status: t.status,
    assignee_id: t.assignee_id,
    brand_id: String(t.brand_id),
    channel: t.via?.channel || 'unknown',
    created_at: t.created_at,
    na_category: naCategory,
    na_category_label: CATEGORY_LABELS[naCategory] || naCategory || 'Uncategorized',
    satisfaction_score: t.satisfaction_rating?.score || null,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '30')
  const brandId = searchParams.get('brand') || 'all'

  if (!EMAIL || !TOKEN) {
    return NextResponse.json({ error: 'Zendesk credentials not configured' }, { status: 500 })
  }

  try {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().split('T')[0]

    const brandIdsToQuery = brandId === 'all' ? NA_BRAND_IDS : [brandId]

    // 1. DTC backlog count — use the view directly for exact match with Zendesk UI
    //    View already has all the right filters (group, tag exclusions, excluded assignee, etc.)
    const [viewCountRes, viewTicketsRes, recentResults, csatResults, agentsRes] = await Promise.all([
      // Exact backlog count matching your Zendesk view
      zdFetch(`/api/v2/views/${DTC_BACKLOG_VIEW_ID}/count.json`),
      // Backlog tickets (up to 100) for category breakdown
      zdFetch(`/api/v2/views/${DTC_BACKLOG_VIEW_ID}/tickets.json?per_page=100`),
      // Recent solved tickets per brand for resolved count
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket status:solved status:closed brand_id:${id} created>${sinceStr}`, 1, 1)
      )),
      // CSAT counts per brand
      Promise.all(brandIdsToQuery.map(id =>
        Promise.all([
          zdSearch(`type:ticket brand_id:${id} satisfaction:good created>${sinceStr}`, 1, 1),
          zdSearch(`type:ticket brand_id:${id} satisfaction:bad created>${sinceStr}`, 1, 1),
        ]).then(([good, bad]) => ({ good_count: good.count || 0, bad_count: bad.count || 0 }))
      )),
      // Agents in NA DTC group
      zdFetch(`/api/v2/groups/${NA_DTC_GROUP_ID}/users.json?per_page=100`),
    ])

    // Exact backlog count from view
    const dtcBacklogCount = viewCountRes.view_count?.value || 0

    // Backlog tickets for breakdowns
    const backlogTickets = (viewTicketsRes.tickets || []).map(parseTicket)

    // Filter by brand if a specific brand is selected
    const filteredBacklog = brandId === 'all'
      ? backlogTickets
      : backlogTickets.filter((t: any) => t.brand_id === brandId)

    // Backlog by brand — use per-brand search counts for accuracy
    const backlogByBrandCounts = await Promise.all(
      brandIdsToQuery.map(id =>
        zdSearch(`type:ticket status:new status:open status:hold group:${NA_DTC_GROUP_ID} brand_id:${id} -tags:"pro code" -tags:pro_fjr -tags:pro_ha -tags:pro_hanwag -tags:chargeback -tags:pro_rr`, 1, 1)
          .then(r => ({ name: NA_BRANDS[id], open: r.count || 0 }))
      )
    )

    // Resolved totals
    const resolvedCount = recentResults.reduce((sum, r) => sum + (r.count || 0), 0)

    // CSAT
    const csatGood = csatResults.reduce((sum, r) => sum + r.good_count, 0)
    const csatBad = csatResults.reduce((sum, r) => sum + r.bad_count, 0)
    const csatTotal = csatGood + csatBad
    const csatRate = csatTotal > 0 ? Math.round((csatGood / csatTotal) * 100) : null

    // Agents
    const agents = (agentsRes.users || []).filter((u: any) => u.active)
    const agentStats: Record<string, any> = {}
    agents.forEach((a: any) => {
      agentStats[String(a.id)] = { id: String(a.id), name: a.name, email: a.email, open: 0, resolved: 0 }
    })

    filteredBacklog.forEach((t: any) => {
      const key = String(t.assignee_id)
      if (agentStats[key]) agentStats[key].open++
    })

    // Backlog by category from view tickets
    const backlogByCategory: Record<string, number> = {}
    filteredBacklog.forEach((t: any) => {
      if (t.na_category === 'na_warranty_repair') return // exclude warranty from DTC breakdown
      const cat = t.na_category_label || 'Uncategorized'
      backlogByCategory[cat] = (backlogByCategory[cat] || 0) + 1
    })

    // Channel breakdown from backlog
    const channelBreakdown: Record<string, number> = {}
    filteredBacklog.forEach((t: any) => {
      channelBreakdown[t.channel] = (channelBreakdown[t.channel] || 0) + 1
    })

    return NextResponse.json({
      overview: {
        backlog_dtc: dtcBacklogCount,  // exact match to Zendesk "DTC New/Open/Hold (No IP)" view
        resolved_period: resolvedCount,
        csat_rate: csatRate,
        csat_good: csatGood,
        csat_bad: csatBad,
        csat_total: csatTotal,
        days,
        brand_id: brandId,
        fetched_at: new Date().toISOString(),
      },
      agents: Object.values(agentStats),
      backlog_by_category: backlogByCategory,
      backlog_by_brand: backlogByBrandCounts,
      channel_breakdown: channelBreakdown,
    })
  } catch (err: any) {
    console.error('Dashboard error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
