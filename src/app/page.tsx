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

function fmtMins(mins: number | null): string {
  if (mins == null) return '--'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

interface Agent {
  id: string; name: string; email: string
  open: number; resolved: number
  csat_good: number; csat_bad: number; csat_rate: number | null
  avg_first_reply_mins: number | null
  avg_resolution_mins: number | null
}

interface DashData {
  overview: {
    backlog_dtc: number
    resolved_period: number
    csat_rate: number | null
    csat_good: number; csat_bad: number; csat_total: number
    avg_first_reply_mins: number | null
    avg_resolution_mins: number | null
    days: number; brand_id: string; fetched_at: string
  }
  agents: Agent[]
  backlog_by_brand: Array<{ name: string; open: number }>
  error?: string
}

function LoadBadge({ open }: { open: number }) {
  if (open > 15) return <span className={styles.badgeDanger}>High</span>
  if (open > 8) return <span className={styles.badgeWarn}>Med</span>
  return <span className={styles.badgeOk}>OK</span>
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const [brand, setBrand] = useState('all')
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

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
  const agents = [...(data?.agents || [])].sort((a, b) => b.open - a.open)
  const backlogBrands = data?.backlog_by_brand || []
  const maxBrand = Math.max(...backlogBrands.map(b => b.open), 1)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>NA CX Dashboard</h1>
          {lastUpdated && <p className={styles.subtitle}>Updated {lastUpdated}{loading ? ' — refreshing…' : ''}</p>}
        </div>
        <div className={styles.controls}>
          {[7, 30, 90].map(d => (
            <button key={d} className={days === d ? styles.btnActive : styles.btn} onClick={() => setDays(d)}>{d}d</button>
          ))}
          <button className={styles.btn} onClick={fetchData} disabled={loading}>{loading ? '…' : '↺ Refresh'}</button>
        </div>
      </header>

      <div className={styles.brandPills}>
        {BRANDS.map(b => (
          <button key={b.id} className={brand === b.id ? styles.pillActive : styles.pill} onClick={() => setBrand(b.id)}>{b.label}</button>
        ))}
      </div>

      {data?.error && <div className={styles.errorBanner}>⚠ Error: {data.error}</div>}

      {/* KPI Row */}
      <section className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>DTC Backlog</span>
          <span className={styles.kpiValue}>{loading && !ov ? '…' : (ov?.backlog_dtc ?? '--')}</span>
          <span className={styles.kpiSub}>New + Open + Hold, no IP/Pro</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Resolved ({ov?.days ?? days}d)</span>
          <span className={styles.kpiValue}>{ov?.resolved_period ?? '--'}</span>
          <span className={styles.kpiSub}>solved + closed in period</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>CSAT ({ov?.days ?? days}d)</span>
          <span className={styles.kpiValue}>{ov?.csat_rate != null ? `${ov.csat_rate}%` : '--'}</span>
          <span className={styles.kpiSub}>
            {ov?.csat_total ? `${ov.csat_good} 👍  ${ov.csat_bad} 👎` : 'no ratings yet'}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Avg First Reply ({ov?.days ?? days}d)</span>
          <span className={styles.kpiValue}>{fmtMins(ov?.avg_first_reply_mins ?? null)}</span>
          <span className={styles.kpiSub}>business hours</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Avg Resolution ({ov?.days ?? days}d)</span>
          <span className={styles.kpiValue}>{fmtMins(ov?.avg_resolution_mins ?? null)}</span>
          <span className={styles.kpiSub}>open to close, business hours</span>
        </div>
      </section>

      {/* Backlog by brand */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Backlog by brand</h2>
        {backlogBrands.map(b => (
          <div key={b.name} className={styles.barRow}>
            <span className={styles.barLabel}>{b.name}</span>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${(b.open / maxBrand) * 100}%` }} />
            </div>
            <span className={styles.barCount}>{b.open}</span>
          </div>
        ))}
      </div>

      {/* Agent table */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Agent performance</h2>
        {agents.length === 0
          ? <p className={styles.muted}>No agent data</p>
          : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Open now</th>
                  <th>Resolved ({ov?.days ?? days}d)</th>
                  <th>CSAT</th>
                  <th>Avg First Reply</th>
                  <th>Avg Resolution</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(a => {
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
                      <td><strong>{a.open}</strong></td>
                      <td>{a.resolved}</td>
                      <td>
                        {a.csat_rate != null
                          ? <span title={`${a.csat_good} good / ${a.csat_bad} bad`}>{a.csat_rate}%</span>
                          : <span className={styles.muted}>--</span>}
                      </td>
                      <td>{fmtMins(a.avg_first_reply_mins)}</td>
                      <td>{fmtMins(a.avg_resolution_mins)}</td>
                      <td><LoadBadge open={a.open} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}
