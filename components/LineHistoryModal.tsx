'use client'

import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { Prop, LineHistory } from '@/lib/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'

const SOURCE_COLORS: Record<string, string> = {
  underdog: '#facc15',
  kalshi: '#4ade80',
  prizepicks: '#c084fc',
  draftkings: '#60a5fa',
  fanduel: '#fb923c',
}

const SOURCE_LABELS: Record<string, string> = {
  underdog: 'Underdog',
  kalshi: 'Kalshi',
  prizepicks: 'PrizePicks',
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
}

interface SourceData {
  line: number | null
  over: string | null
  under: string | null
  updated_at: string
  prop: Prop
}

interface Props {
  playerName: string
  statType: string
  sportId: string
  gameDisplay: string
  sources: Record<string, SourceData>
  onClose: () => void
}

export default function LineHistoryModal({ playerName, statType, sportId, gameDisplay, sources, onClose }: Props) {
  const [historyBySource, setHistoryBySource] = useState<Record<string, LineHistory[]>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'line' | 'price'>('line')

  const activeSources = Object.keys(sources)

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true)
      const supabase = getSupabase()

      // Fetch history for all source prop IDs
      const results: Record<string, LineHistory[]> = {}
      await Promise.all(
        activeSources.map(async (src) => {
          const propId = sources[src].prop.id
          const { data } = await supabase
            .from('ud_line_history')
            .select('*')
            .eq('prop_id', propId)
            .order('recorded_at', { ascending: true })
            .limit(500)
          results[src] = (data || []) as LineHistory[]
        })
      )
      setHistoryBySource(results)
      setLoading(false)
    }
    fetchHistory()

    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Build unified chart data: timestamp → { time, source1_line, source2_line, ... }
  const chartData = (() => {
    // Collect all events across sources
    const events: { ts: number; source: string; line: number | null; over: number | null; under: number | null }[] = []

    for (const src of activeSources) {
      const hist = historyBySource[src] || []
      for (const h of hist) {
        if (h.event_type === 'remove') continue
        events.push({
          ts: new Date(h.recorded_at).getTime(),
          source: src,
          line: h.stat_value,
          over: h.over_price ? parseInt(h.over_price) : null,
          under: h.under_price ? parseInt(h.under_price) : null,
        })
      }
    }

    if (events.length === 0) return []

    // Sort by time
    events.sort((a, b) => a.ts - b.ts)

    // Build chart points: at each event, carry forward latest values for all sources
    const latest: Record<string, { line: number | null; over: number | null; under: number | null }> = {}
    const points: Record<string, any>[] = []

    for (const ev of events) {
      latest[ev.source] = { line: ev.line, over: ev.over, under: ev.under }
      const point: Record<string, any> = {
        time: new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        timestamp: ev.ts,
      }
      for (const src of activeSources) {
        const val = latest[src]
        if (val) {
          point[`${src}_line`] = val.line
          point[`${src}_over`] = val.over
          point[`${src}_under`] = val.under
        }
      }
      points.push(point)
    }

    return points
  })()

  const allLineValues = chartData.flatMap(d =>
    activeSources.map(s => d[`${s}_line`]).filter((v): v is number => v != null)
  )
  const lineMin = allLineValues.length ? Math.min(...allLineValues) : 0
  const lineMax = allLineValues.length ? Math.max(...allLineValues) : 0
  const linePad = Math.max((lineMax - lineMin) * 0.2, 0.5)

  const allPriceValues = chartData.flatMap(d =>
    activeSources.flatMap(s => [d[`${s}_over`], d[`${s}_under`]]).filter((v): v is number => v != null)
  )
  const priceMin = allPriceValues.length ? Math.min(...allPriceValues) : -200
  const priceMax = allPriceValues.length ? Math.max(...allPriceValues) : 200

  const totalHistory = Object.values(historyBySource).reduce((sum, h) => sum + h.length, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-bold">{playerName}</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
              <span className="px-2 py-0.5 rounded bg-gray-800 text-xs">{sportId}</span>
              <span>{statType}</span>
              {gameDisplay && <span>· {gameDisplay}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">&times;</button>
        </div>

        {/* Current lines from all sources */}
        <div className="flex items-center gap-4 p-5 border-b border-gray-800 flex-wrap">
          {activeSources.map(src => {
            const d = sources[src]
            const color = SOURCE_COLORS[src]
            return (
              <div key={src} className="text-center min-w-[100px]">
                <div className="text-xs text-gray-500 mb-1" style={{ color }}>{SOURCE_LABELS[src] || src}</div>
                <div className="text-lg font-bold font-mono" style={{ color }}>
                  {d.line ?? '—'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {d.over && <span className="text-green-400">O {formatPrice(d.over)}</span>}
                  {d.over && d.under && <span className="mx-1">/</span>}
                  {d.under && <span className="text-red-400">U {formatPrice(d.under)}</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Chart */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView('line')}
                className={`px-3 py-1 text-xs rounded-lg ${view === 'line' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}
              >
                Line Value
              </button>
              <button
                onClick={() => setView('price')}
                className={`px-3 py-1 text-xs rounded-lg ${view === 'price' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}
              >
                Prices
              </button>
            </div>
            <div className="text-xs text-gray-500">
              {totalHistory} data points · {activeSources.length} source{activeSources.length !== 1 ? 's' : ''}
            </div>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-gray-500">Loading history...</div>
          ) : chartData.length <= 1 ? (
            <div className="h-64 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-2xl mb-2">📊</div>
                <div>No movement yet — check back as lines move</div>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              {view === 'line' ? (
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis
                    domain={[lineMin - linePad, lineMax + linePad]}
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    tickFormatter={v => v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  <Legend />
                  {activeSources.map(src => (
                    <Line
                      key={src}
                      type="stepAfter"
                      dataKey={`${src}_line`}
                      stroke={SOURCE_COLORS[src]}
                      strokeWidth={2}
                      dot={{ r: 2, fill: SOURCE_COLORS[src] }}
                      activeDot={{ r: 4 }}
                      name={SOURCE_LABELS[src] || src}
                      connectNulls
                    />
                  ))}
                </LineChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis domain={[priceMin - 20, priceMax + 20]} stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(value: any, name: any) => [`${value > 0 ? '+' : ''}${value}`, name]}
                  />
                  <Legend />
                  {activeSources.map(src => (
                    <Line
                      key={`${src}-over`}
                      type="stepAfter"
                      dataKey={`${src}_over`}
                      stroke={SOURCE_COLORS[src]}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name={`${SOURCE_LABELS[src]} Over`}
                      connectNulls
                    />
                  ))}
                  {activeSources.map(src => (
                    <Line
                      key={`${src}-under`}
                      type="stepAfter"
                      dataKey={`${src}_under`}
                      stroke={SOURCE_COLORS[src]}
                      strokeWidth={1}
                      strokeDasharray="4 2"
                      dot={{ r: 1 }}
                      name={`${SOURCE_LABELS[src]} Under`}
                      connectNulls
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>

        {/* History table — combined */}
        {totalHistory > 1 && (
          <div className="px-5 pb-5">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Change Log</h3>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="bg-gray-800 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-gray-400">Time</th>
                    <th className="text-left px-3 py-1.5 text-gray-400">Source</th>
                    <th className="text-left px-3 py-1.5 text-gray-400">Event</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Line</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Over</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Under</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(historyBySource)
                    .flatMap(([src, hist]) => hist.map(h => ({ ...h, _src: src })))
                    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
                    .map((h, i) => (
                      <tr key={`${h._src}-${h.id}`} className="border-t border-gray-800/50">
                        <td className="px-3 py-1.5 text-gray-500">
                          {new Date(h.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="px-3 py-1.5">
                          <span style={{ color: SOURCE_COLORS[h._src] }}>{SOURCE_LABELS[h._src] || h._src}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            h.event_type === 'swap' ? 'bg-yellow-900/50 text-yellow-400' :
                            h.event_type === 'remove' ? 'bg-red-900/50 text-red-400' :
                            'bg-gray-800 text-gray-400'
                          }`}>
                            {h.event_type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-indigo-400">{h.stat_value ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatPrice(h.over_price)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatPrice(h.under_price)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatPrice(price: string | null): string {
  if (!price) return '—'
  const num = parseInt(price)
  return num > 0 ? `+${price}` : price
}
