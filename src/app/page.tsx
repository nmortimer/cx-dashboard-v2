'use client'

import { useState, useEffect, useCallback } from 'react'
import styles from './page.module.css'

const BRANDS = [
  { id: 'all', label: 'All NA Brands' },
  { id: '360001345039', label: 'Fjällräven US' },
  { id: '10360727124754', label: 'Fjällräven CA' },
  { id: '360001351320', label: 'Hanwag NA' },
  { id: '360001351360', label: 'Royal Robbins NA' },
]

function fmtTime(sec: number | null): string {
  if (!sec || sec === 0) return '--'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function LoadBadge({ open }: { open: number }) {
  if (open > 15) return <span className={styles.badgeDanger}>High</span>
  if (open > 8) return <span className={styles.badgeWarn}>Med</span>
  return <span className={styles.badgeOk}>OK</span>
}

function CsatBadge({ score }: { score: string | null }) {
  if (!score || score === 'unoffered') return <span className={styles.muted}>--</span>
  if (score === 'good') return <span className={styles.badgeOk}>👍</span>
  if (score === 'bad') return <span className={styles.badgeDanger}>👎</span>
  return <span className={styles.muted}>{score}</span>
}

interface DashData {
  overview: {
    open_tickets: number
    resolved_period: number
    total_volume: number
    total_all_time: number
    csat_rate: number | null
    csat_good: number
    csat_bad: number
    csat_offered: number
    avg_handle_time_sec: number | null
    days: number
    brand_id: string
    fetched_at: string
  }
  agents: Array<{
    id: string; name: string; email: string
    resolved: number; open: number
    total_time_sec: number; ticket_count_with_time: number
    csat_good: number; csat_bad: number; csat_offered: number
  }>
  backlog_by_category: Record<string, number>
  backlog_by_brand: Array<{ name: string; open: number; total: number }>
  channel_breakdown: Record<string, number>
  sample_ticket: any
  error?: string
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const [brand, setBrand] = useState('all')
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zendesk?days=${days}&brand=${brand}`)
      const json = await res.json()
      setData(json)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (e: any) {
      setData({ error: e.message } as any)
    } finally {
      setLoading(false)
    }
  }, [days, brand])

  useEffect(() => { fetchData() }, [fetchData])

  const ov = data?.overview
  const agents = data?.agents || []
  const backlogCats = data?.backlog_by_category || {}
  const backlogBrands = data?.backlog_by_brand || []
  const channels = data?.channel_breakdown || {}

  const maxCat = Math.max(...Object.values(backlogCats), 1)
  const maxBrand = Math.max(...backlogBrands.map(b => b.open), 1)
  const maxCh = Math.max(...Object.values(channels), 1)

  const sortedAgents = [...agents].sort((a, b) => b.resolved - a.resolved)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>NA CX Dashboard</h1>
          {lastUpdated && <p className={styles.subtitle}>Updated {lastUpdated}</p>}
        </div>
        <div className={styles.controls}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              className={days === d ? styles.btnActive : styles.btn}
              onClick={() => setDays(d)}
            >{d}d</button>
          ))}
          <button className={styles.btn} onClick={fetchData} disabled={loading}>
            {loading ? '…' : '↺ Refresh'}
          </button>
        </div>
      </header>

      <div className={styles.brandPills}>
        {BRANDS.map(b => (
          <button
            key={b.id}
            className={brand === b.id ? styles.pillActive : styles.pill}
            onClick={() => setBrand(b.id)}
          >{b.label}</button>
        ))}
      </div>

      {data?.error && (
        <div className={styles.errorBanner}>⚠ Error: {data.error}</div>
      )}

      {/* KPI Row */}
      <section className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Open tickets</span>
          <span className={styles.kpiValue}>{ov?.open_tickets ?? '--'}</span>
          <span className={styles.kpiSub}>current backlog</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Resolved ({days}d)</span>
          <span className={styles.kpiValue}>{ov?.resolved_period ?? '--'}</span>
          <span className={styles.kpiSub}>of {ov?.total_volume ?? '--'} total</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>CSAT</span>
          <span className={styles.kpiValue}>
            {ov?.csat_rate != null ? `${ov.csat_rate}%` : '--'}
          </span>
          <span className={styles.kpiSub}>
            {ov?.csat_offered ? `${ov.csat_good}👍 ${ov.csat_bad}👎 of ${ov.csat_offered} offered` : 'no surveys yet'}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Avg handle time</span>
          <span className={styles.kpiValue}>{fmtTime(ov?.avg_handle_time_sec ?? null)}</span>
          <span className={styles.kpiSub}>via Time Tracking app</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Total volume</span>
          <span className={styles.kpiValue}>{ov?.total_volume ?? '--'}</span>
          <span className={styles.kpiSub}>last {days} days</span>
        </div>
      </section>

      <div className={styles.grid2}>
        {/* Backlog by category */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Backlog by contact reason</h2>
          {Object.entries(backlogCats).length === 0
            ? <p className={styles.muted}>No open tickets</p>
            : Object.entries(backlogCats)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => (
                  <div key={cat} className={styles.barRow}>
                    <span className={styles.barLabel}>{cat}</span>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{ width: `${(count / maxCat) * 100}%` }}
                      />
                    </div>
                    <span className={styles.barCount}>{count}</span>
                  </div>
                ))}
        </div>

        {/* Brand breakdown */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Open tickets by brand</h2>
          {backlogBrands.map(b => (
            <div key={b.name} className={styles.barRow}>
              <span className={styles.barLabel}>{b.name}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${(b.open / maxBrand) * 100}%` }}
                />
              </div>
              <span className={styles.barCount}>{b.open}</span>
            </div>
          ))}
          <p className={styles.muted} style={{ marginTop: '12px', fontSize: '12px' }}>Open / current backlog per brand</p>
        </div>
      </div>

      {/* Agent performance */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Agent performance</h2>
        {sortedAgents.length === 0 ? (
          <p className={styles.muted}>No agent data</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Resolved ({days}d)</th>
                <th>Avg handle time</th>
                <th>CSAT</th>
                <th>Open now</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map(a => {
                const avgSec = a.ticket_count_with_time > 0
                  ? Math.round(a.total_time_sec / a.ticket_count_with_time)
                  : null
                const csatPct = (a.csat_good + a.csat_bad) > 0
                  ? Math.round((a.csat_good / (a.csat_good + a.csat_bad)) * 100)
                  : null
                const initials = a.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <tr key={a.id}>
                    <td>
                      <div className={styles.agentCell}>
                        <div className={styles.avatar}>{initials}</div>
                        <div>
                          <div>{a.name}</div>
                          <div className={styles.muted} style={{ fontSize: '11px' }}>{a.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>{a.resolved}</td>
                    <td>{fmtTime(avgSec)}</td>
                    <td>
                      {csatPct != null
                        ? <span>{csatPct}% <span className={styles.muted}>({a.csat_offered} rated)</span></span>
                        : <span className={styles.muted}>--</span>
                      }
                    </td>
                    <td>{a.open}</td>
                    <td><LoadBadge open={a.open} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Channel breakdown */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Channel breakdown ({days}d)</h2>
        <div className={styles.channelGrid}>
          {Object.entries(channels)
            .sort(([, a], [, b]) => b - a)
            .map(([ch, count]) => (
              <div key={ch} className={styles.channelCard}>
                <div className={styles.channelDot} />
                <span className={styles.channelName}>{ch}</span>
                <span className={styles.channelCount}>{count}</span>
                <div className={styles.channelBar}>
                  <div
                    className={styles.channelBarFill}
                    style={{ width: `${(count / maxCh) * 100}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Debug panel */}
      <div className={styles.card}>
        <button
          className={styles.btn}
          onClick={() => setDebugOpen(v => !v)}
          style={{ marginBottom: debugOpen ? '12px' : 0 }}
        >
          {debugOpen ? '▾' : '▸'} Debug / Sample ticket
        </button>
        {debugOpen && (
          <pre className={styles.debug}>
            {JSON.stringify(data?.sample_ticket, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
