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
const EXCLUDED_AGENT_ID = '28767951817234'
const EXCLUDED_TAGS = 'pro code pro_fjr pro_ha pro_hanwag chargeback pro_rr'

// Hardcoded NA DTC agent list — no group API call needed
const NA_AGENTS = [
  { id: '35310781807378', name: 'Bethany Coates',    email: 'bethany.coates@fenixoutdoor.us' },
  { id: '28096751190418', name: 'Nadia Savard',      email: 'nadia.savard@fenixoutdoor.ca' },
  { id: '32696113103122', name: 'Christopher Junge', email: 'christopher.junge@fenixoutdoor.us' },
  { id: '30945503512594', name: 'Michael Lang',      email: 'michael.lang@fenixoutdoor.us' },
  { id: '370521577940',   name: 'Steve Bailey',      email: 'steve.bailey@fjallraven.us' },
  { id: '27746093549202', name: 'Tyler Burns',       email: 'tyler.burns@fenixoutdoor.us' },
  { id: '33019737250322', name: 'Kennedy Just',      email: 'kennedy.just@fenixoutdoor.us' },
  { id: '8371024885266',  name: 'Janee Howerton',    email: 'janee.howerton@fenixoutdoor.us' },
]

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
    next: { revalidate: 0 }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Zendesk ${res.status} ${path}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function zdSearch(query: string, perPage = 1) {
  const url = `https://${SUBDOMAIN}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=${perPage}`
  const res = await fetch(url, {
    headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json' },
    next: { revalidate: 0 }
  })
  if (!res.ok) throw new Error(`Search ${res.status}: ${query.slice(0, 80)}`)
  return res.json()
}

function dtcBacklogQuery(brandId: string) {
  return `type:ticket status:new status:open status:hold group:${NA_DTC_GROUP_ID} brand_id:${brandId} -tags:"${EXCLUDED_TAGS}" -assignee:${EXCLUDED_AGENT_ID}`
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
    const brandFilter = brandId !== 'all' ? ` brand_id:${brandId}` : ''

    const [
      backlogCounts,
      solvedCounts,
      closedCounts,
      csatGoodCounts,
      csatBadCounts,
      agentOpenCounts,
      agentSolvedCounts,
      agentCsatGood,
      agentCsatBad,
    ] = await Promise.all([
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(dtcBacklogQuery(id)).then(r => ({ id, count: r.count || 0 }))
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket status:solved brand_id:${id} group:${NA_DTC_GROUP_ID} solved>${sinceStr}`).then(r => r.count || 0)
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket status:closed brand_id:${id} group:${NA_DTC_GROUP_ID} solved>${sinceStr}`).then(r => r.count || 0)
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket brand_id:${id} group:${NA_DTC_GROUP_ID} satisfaction:good solved>${sinceStr}`).then(r => r.count || 0)
      )),
      Promise.all(brandIdsToQuery.map(id =>
        zdSearch(`type:ticket brand_id:${id} group:${NA_DTC_GROUP_ID} satisfaction:bad solved>${sinceStr}`).then(r => r.count || 0)
      )),
      Promise.all(NA_AGENTS.map(a =>
        zdSearch(`type:ticket status:new status:open status:hold group:${NA_DTC_GROUP_ID} assignee:${a.id}${brandFilter}`).then(r => ({ id: a.id, count: r.count || 0 }))
      )),
      Promise.all(NA_AGENTS.map(a =>
        zdSearch(`type:ticket status:solved status:closed group:${NA_DTC_GROUP_ID} assignee:${a.id} solved>${sinceStr}${brandFilter}`).then(r => ({ id: a.id, count: r.count || 0 }))
      )),
      Promise.all(NA_AGENTS.map(a =>
        zdSearch(`type:ticket group:${NA_DTC_GROUP_ID} assignee:${a.id} satisfaction:good solved>${sinceStr}${brandFilter}`).then(r => ({ id: a.id, count: r.count || 0 }))
      )),
      Promise.all(NA_AGENTS.map(a =>
        zdSearch(`type:ticket group:${NA_DTC_GROUP_ID} assignee:${a.id} satisfaction:bad solved>${sinceStr}${brandFilter}`).then(r => ({ id: a.id, count: r.count || 0 }))
      )),
    ])

    const dtcBacklogTotal = backlogCounts.reduce((s, b) => s + b.count, 0)
    const resolvedTotal = solvedCounts.reduce((a, b) => a + b, 0) + closedCounts.reduce((a, b) => a + b, 0)
    const csatGoodTotal = csatGoodCounts.reduce((a, b) => a + b, 0)
    const csatBadTotal = csatBadCounts.reduce((a, b) => a + b, 0)
    const csatTotal = csatGoodTotal + csatBadTotal
    const csatRate = csatTotal > 0 ? Math.round((csatGoodTotal / csatTotal) * 100) : null

    const backlogByBrand = backlogCounts.map(b => ({ name: NA_BRANDS[b.id], open: b.count }))

    const openMap: Record<string, number> = {}
    const solvedMap: Record<string, number> = {}
    const csatGoodMap: Record<string, number> = {}
    const csatBadMap: Record<string, number> = {}
    agentOpenCounts.forEach(a => { openMap[a.id] = a.count })
    agentSolvedCounts.forEach(a => { solvedMap[a.id] = a.count })
    agentCsatGood.forEach(a => { csatGoodMap[a.id] = a.count })
    agentCsatBad.forEach(a => { csatBadMap[a.id] = a.count })

    // Fetch resolution/reply time from recent solved tickets (up to 50)
    const recentSolvedRes = await zdSearch(
      `type:ticket group:${NA_DTC_GROUP_ID} status:solved solved>${sinceStr}${brandFilter}`,
      50
    )
    const recentTickets: any[] = recentSolvedRes.results || []

    const agentFirstReplyMins: Record<string, number[]> = {}
    const agentResolutionMins: Record<string, number[]> = {}
    const allFirstReply: number[] = []
    const allResolution: number[] = []

    if (recentTickets.length > 0) {
      const metricsResults = await Promise.all(
        recentTickets.map((t: any) =>
          zdFetch(`/api/v2/tickets/${t.id}/metrics.json`).catch(() => null)
        )
      )
      metricsResults.forEach((m: any, i: number) => {
        if (!m?.ticket_metric) return
        const metric = m.ticket_metric
        const assigneeId = String(recentTickets[i]?.assignee_id)
        const fr = metric.reply_time_in_minutes?.business
        const res = metric.full_resolution_time_in_minutes?.business
        if (fr != null && fr > 0) {
          allFirstReply.push(fr)
          if (!agentFirstReplyMins[assigneeId]) agentFirstReplyMins[assigneeId] = []
          agentFirstReplyMins[assigneeId].push(fr)
        }
        if (res != null && res > 0) {
          allResolution.push(res)
          if (!agentResolutionMins[assigneeId]) agentResolutionMins[assigneeId] = []
          agentResolutionMins[assigneeId].push(res)
        }
      })
    }

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

    const agents = NA_AGENTS.map(a => {
      const good = csatGoodMap[a.id] || 0
      const bad = csatBadMap[a.id] || 0
      const rated = good + bad
      return {
        id: a.id, name: a.name, email: a.email,
        open: openMap[a.id] || 0,
        resolved: solvedMap[a.id] || 0,
        csat_good: good, csat_bad: bad,
        csat_rate: rated > 0 ? Math.round((good / rated) * 100) : null,
        avg_first_reply_mins: avg(agentFirstReplyMins[a.id] || []),
        avg_resolution_mins: avg(agentResolutionMins[a.id] || []),
      }
    })

    return NextResponse.json({
      overview: {
        backlog_dtc: dtcBacklogTotal,
        resolved_period: resolvedTotal,
        csat_rate: csatRate,
        csat_good: csatGoodTotal,
        csat_bad: csatBadTotal,
        csat_total: csatTotal,
        avg_first_reply_mins: avg(allFirstReply),
        avg_resolution_mins: avg(allResolution),
        days,
        brand_id: brandId,
        fetched_at: new Date().toISOString(),
      },
      agents,
      backlog_by_brand: backlogByBrand,
    })
  } catch (err: any) {
    console.error('Dashboard error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
