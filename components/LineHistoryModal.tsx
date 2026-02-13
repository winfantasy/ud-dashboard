'use client'

import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { Prop, LineHistory } from '@/lib/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

interface Props {
  prop: Prop
  onClose: () => void
}

export default function LineHistoryModal({ prop, onClose }: Props) {
  const [history, setHistory] = useState<LineHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'line' | 'price'>('line')

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true)
      const { data, error } = await getSupabase()
        .from('ud_line_history')
        .select('*')
        .eq('prop_id', prop.id)
        .order('recorded_at', { ascending: true })
        .limit(500)

      if (!error && data) {
        setHistory(data as LineHistory[])
      }
      setLoading(false)
    }
    fetchHistory()

    // Close on escape
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [prop.id, onClose])

  const chartData = history
    .filter(h => h.event_type !== 'remove')
    .map(h => ({
      time: new Date(h.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp: new Date(h.recorded_at).getTime(),
      line: h.stat_value,
      overPrice: h.over_price ? parseInt(h.over_price) : null,
      underPrice: h.under_price ? parseInt(h.under_price) : null,
      overDecimal: h.over_decimal,
      underDecimal: h.under_decimal,
      event: h.event_type
    }))

  const lineValues = chartData.map(d => d.line).filter(v => v != null) as number[]
  const lineMin = lineValues.length ? Math.min(...lineValues) : 0
  const lineMax = lineValues.length ? Math.max(...lineValues) : 0
  const linePad = Math.max((lineMax - lineMin) * 0.2, 0.5)

  const priceValues = chartData.flatMap(d => [d.overPrice, d.underPrice]).filter(v => v != null) as number[]
  const priceMin = priceValues.length ? Math.min(...priceValues) : -200
  const priceMax = priceValues.length ? Math.max(...priceValues) : 200

  const totalChanges = history.filter(h => h.event_type === 'swap').length
  const firstSeen = history.length ? new Date(history[0].recorded_at) : null
  const lastSeen = history.length ? new Date(history[history.length - 1].recorded_at) : null

  // Calculate line movement
  const lineChanges = chartData.filter(d => d.line != null)
  const openingLine = lineChanges.length > 0 ? lineChanges[0].line : null
  const currentLine = lineChanges.length > 0 ? lineChanges[lineChanges.length - 1].line : null
  const lineDelta = openingLine != null && currentLine != null ? currentLine - openingLine : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-bold">{prop.player_name || 'Unknown'}</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
              <span className="px-2 py-0.5 rounded bg-gray-800 text-xs">{prop.sport_id}</span>
              <span>{prop.stat_type}</span>
              {prop.game_display && <span>· {prop.game_display}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">&times;</button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 p-5 border-b border-gray-800">
          <StatBox label="Current Line" value={prop.stat_value?.toString() || '—'} accent />
          <StatBox label="Over" value={formatPrice(prop.over_price)} color={priceColor(prop.over_price)} />
          <StatBox label="Under" value={formatPrice(prop.under_price)} color={priceColor(prop.under_price)} />
          <StatBox
            label="Movement"
            value={lineDelta != null ? `${lineDelta > 0 ? '+' : ''}${lineDelta.toFixed(1)}` : '—'}
            color={lineDelta != null ? (lineDelta > 0 ? '#22c55e' : lineDelta < 0 ? '#ef4444' : '#9ca3af') : undefined}
          />
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
              {totalChanges} change{totalChanges !== 1 ? 's' : ''} · {firstSeen ? `Since ${firstSeen.toLocaleTimeString()}` : ''}
            </div>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-gray-500">Loading history...</div>
          ) : chartData.length <= 1 ? (
            <div className="h-64 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-2xl mb-2">📊</div>
                <div>No movement yet — check back as the line moves</div>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
                  {openingLine != null && (
                    <ReferenceLine y={openingLine} stroke="#6366f1" strokeDasharray="5 5" label={{ value: `Open: ${openingLine}`, fill: '#6366f1', fontSize: 11 }} />
                  )}
                  <Line
                    type="stepAfter"
                    dataKey="line"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#818cf8' }}
                    activeDot={{ r: 5, fill: '#a78bfa' }}
                    name="Line"
                  />
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
                  <ReferenceLine y={-110} stroke="#374151" strokeDasharray="3 3" />
                  <Line type="stepAfter" dataKey="overPrice" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Over" />
                  <Line type="stepAfter" dataKey="underPrice" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="Under" />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>

        {/* History table */}
        {history.length > 1 && (
          <div className="px-5 pb-5">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Change Log</h3>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="bg-gray-800 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-gray-400">Time</th>
                    <th className="text-left px-3 py-1.5 text-gray-400">Event</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Line</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Over</th>
                    <th className="text-right px-3 py-1.5 text-gray-400">Under</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h, i) => (
                    <tr key={h.id} className="border-t border-gray-800/50">
                      <td className="px-3 py-1.5 text-gray-500">
                        {new Date(h.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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

function StatBox({ label, value, accent, color }: { label: string; value: string; accent?: boolean; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${accent ? 'text-indigo-400' : ''}`} style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function formatPrice(price: string | null): string {
  if (!price) return '—'
  const num = parseInt(price)
  return num > 0 ? `+${price}` : price
}

function priceColor(price: string | null): string | undefined {
  if (!price) return undefined
  const num = parseInt(price)
  return num > 0 ? '#22c55e' : num < -150 ? '#ef4444' : '#9ca3af'
}
