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

// Confirmed custom field IDs
const FIELD_NA_CATEGORY = 29839585505938
const FIELD_TIME_TOTAL = 22350284321042

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

async function zdSearch(query: string, extra = '') {
  const url = `https://${SUBDOMAIN}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=100${extra}`
  const res = await fetch(url, {
    headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json' },
    next: { revalidate: 300 }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Zendesk search error ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

async function zdFetch(path: string) {
  const url = `https://${SUBDOMAIN}.zendesk.com${path}`
  const res = await fetch(url, {
    headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json' },
    next: { revalidate: 300 }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Zendesk API error ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

function getCustomField(ticket: any, fieldId: number): any {
  const field = ticket.custom_fields?.find((f: any) => f.id === fieldId)
  return field?.value ?? null
}

function parseTickets(tickets: any[]) {
  return tickets.map(t => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    assignee_id: t.assignee_id,
    brand_id: String(t.brand_id),
    brand_name: NA_BRANDS[String(t.brand_id)] || 'Unknown',
    channel: t.via?.channel || 'unknown',
    created_at: t.created_at,
    na_category: getCustomField(t, FIELD_NA_CATEGORY),
    na_category_label: CATEGORY_LABELS[getCustomField(t, FIELD_NA_CATEGORY)] || getCustomField(t, FIELD_NA_CATEGORY) || 'Uncategorized',
    time_total_sec: getCustomField(t, FIELD_TIME_TOTAL),
    satisfaction_score: t.satisfaction_rating?.score || null,
  }))
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

    // Build brand filter — for "all" we run separate queries per brand and merge
    // This avoids the OR+parentheses URL encoding issue entirely
    const brandIdsToQuery = brandId === 'all' ? NA_BRAND_IDS : [brandId]

    // Run queries per brand and merge results
    const [recentResults, openResults, satResults] = await Promise.all([
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket created>${sinceStr} brand_id:${id}`, '&sort_by=created_at&sort_order=desc')
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket status:open brand_id:${id}`)
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket satisfaction:offered created>${sinceStr} brand_id:${id}`)
      )),
    ])

    // Merge and deduplicate by ticket id
    const mergeTickets = (arrays: any[][]) => {
      const seen = new Set<number>()
      const out: any[] = []
      arrays.flat().forEach(t => {
        if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t) }
      })
      return out
    }

    const recentRaw = mergeTickets(recentResults.map(r => r.results || []))
    const openRaw = mergeTickets(openResults.map(r => r.results || []))
    const satRaw = mergeTickets(satResults.map(r => r.results || []))

    const recentTickets = parseTickets(recentRaw)
    const openTickets = parseTickets(openRaw)
    const satTickets = parseTickets(satRaw)

    // Agents — NA DTC group only
    const agentsRes = await zdFetch(`/api/v2/groups/${NA_DTC_GROUP_ID}/users.json?per_page=100`)
    const agents = (agentsRes.users || []).filter((u: any) => u.active)

    // Per-agent stats
    const agentStats: Record<string, any> = {}
    agents.forEach((a: any) => {
      agentStats[String(a.id)] = {
        id: String(a.id), name: a.name, email: a.email,
        resolved: 0, open: 0,
        total_time_sec: 0, ticket_count_with_time: 0,
        csat_good: 0, csat_bad: 0, csat_offered: 0,
      }
    })

    recentTickets.forEach(t => {
      const key = String(t.assignee_id)
      if (!agentStats[key]) return
      if (t.status === 'solved' || t.status === 'closed') agentStats[key].resolved++
    })

    openTickets.forEach(t => {
      const key = String(t.assignee_id)
      if (!agentStats[key]) return
      agentStats[key].open++
      if (t.time_total_sec) {
        agentStats[key].total_time_sec += t.time_total_sec
        agentStats[key].ticket_count_with_time++
      }
    })

    satTickets.forEach(t => {
      const key = String(t.assignee_id)
      if (!agentStats[key]) return
      agentStats[key].csat_offered++
      if (t.satisfaction_score === 'good') agentStats[key].csat_good++
      if (t.satisfaction_score === 'bad') agentStats[key].csat_bad++
    })

    // Backlog by category
    const backlogByCategory: Record<string, number> = {}
    openTickets.forEach(t => {
      const cat = t.na_category_label || 'Uncategorized'
      backlogByCategory[cat] = (backlogByCategory[cat] || 0) + 1
    })

    // Backlog by brand
    const backlogByBrand = NA_BRAND_IDS
      .filter(id => brandId === 'all' || id === brandId)
      .map(id => ({
        name: NA_BRANDS[id],
        open: openTickets.filter(t => t.brand_id === id).length,
        total: recentTickets.filter(t => t.brand_id === id).length,
      }))

    // Channel breakdown
    const channelBreakdown: Record<string, number> = {}
    recentTickets.forEach(t => {
      channelBreakdown[t.channel] = (channelBreakdown[t.channel] || 0) + 1
    })

    const csatGood = satTickets.filter(t => t.satisfaction_score === 'good').length
    const csatBad = satTickets.filter(t => t.satisfaction_score === 'bad').length
    const csatOffered = satTickets.length
    const csatRate = (csatGood + csatBad) > 0
      ? Math.round((csatGood / (csatGood + csatBad)) * 100)
      : null

    const resolvedCount = recentTickets.filter(t => t.status === 'solved' || t.status === 'closed').length

    const ticketsWithTime = recentTickets.filter(t => t.time_total_sec && t.time_total_sec > 0)
    const avgHandleTimeSec = ticketsWithTime.length > 0
      ? Math.round(ticketsWithTime.reduce((s, t) => s + (t.time_total_sec || 0), 0) / ticketsWithTime.length)
      : null

    return NextResponse.json({
      overview: {
        open_tickets: openTickets.length,
        resolved_period: resolvedCount,
        total_volume: recentTickets.length,
        csat_rate: csatRate,
        csat_good: csatGood,
        csat_bad: csatBad,
        csat_offered: csatOffered,
        avg_handle_time_sec: avgHandleTimeSec,
        days,
        brand_id: brandId,
        fetched_at: new Date().toISOString(),
        // Debug counts
        debug: {
          recent_raw: recentRaw.length,
          open_raw: openRaw.length,
          sat_raw: satRaw.length,
          agent_count: agents.length,
        }
      },
      agents: Object.values(agentStats),
      backlog_by_category: backlogByCategory,
      backlog_by_brand: backlogByBrand,
      channel_breakdown: channelBreakdown,
      sample_ticket: recentRaw[0] || null,
    })
  } catch (err: any) {
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
