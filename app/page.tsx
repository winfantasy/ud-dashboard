'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { Prop } from '@/lib/types'
import LineHistoryModal from '@/components/LineHistoryModal'

const SPORTS = ['ALL', 'NBA', 'CBB', 'NHL', 'PGA', 'MMA', 'UNRIVALED'] as const
const STAT_FILTERS: Record<string, string[]> = {
  ALL: [],
  NBA: ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Pts + Rebs + Asts', 'Points + Rebounds', 'Points + Assists', 'Rebounds + Assists', 'Steals', 'Blocks', 'Turnovers', 'Double-Doubles', 'Blks + Stls'],
  CBB: ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Pts + Rebs + Asts'],
  NHL: ['Goals + Assists', 'Shots on Goal', 'Saves', 'Goals Against'],
  PGA: ['Round Strokes', 'Birdies or Better', 'Bogeys or Worse', 'Pars or Better'],
  MMA: [],
  UNRIVALED: ['Points', 'Rebounds', 'Assists', '3-Pointers Made'],
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  underdog: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', dot: 'bg-yellow-400', label: 'UD' },
  kalshi: { bg: 'bg-green-900/30', text: 'text-green-400', dot: 'bg-green-400', label: 'KAL' },
  draftkings: { bg: 'bg-blue-900/30', text: 'text-blue-400', dot: 'bg-blue-400', label: 'DK' },
  prizepicks: { bg: 'bg-purple-900/30', text: 'text-purple-400', dot: 'bg-purple-400', label: 'PP' },
  fanduel: { bg: 'bg-orange-900/30', text: 'text-orange-400', dot: 'bg-orange-400', label: 'FD' },
}

type SortField = 'player_name' | 'stat_type' | 'stat_value' | 'over_price' | 'under_price' | 'updated_at'

export default function Dashboard() {
  const [props, setProps] = useState<Prop[]>([])
  const [sport, setSport] = useState<string>('ALL')
  const [statFilter, setStatFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [selectedProp, setSelectedProp] = useState<Prop | null>(null)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const propsRef = useRef<Map<string, Prop>>(new Map())

  // Fetch initial data
  useEffect(() => {
    async function fetchProps() {
      setLoading(true)
      const { data, error } = await getSupabase()
        .from('ud_props')
        .select('*')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(10000)

      if (error) {
        console.error('Fetch error:', error)
        setLoading(false)
        return
      }

      const propsList = (data || []) as Prop[]
      setProps(propsList)
      propsRef.current = new Map(propsList.map(p => [p.id, p]))
      setLastUpdate(new Date())
      setLoading(false)
    }
    fetchProps()
  }, [])

  // Subscribe to realtime changes - using singleton client
  useEffect(() => {
    const supabase = getSupabase()
    const channel = supabase
      .channel('ud_props_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ud_props'
      }, (payload) => {
        const newProp = payload.new as Prop
        const oldProp = payload.old as Partial<Prop>

        if (payload.eventType === 'DELETE' || newProp?.status === 'removed') {
          propsRef.current.delete(oldProp?.id || newProp?.id || '')
        } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          propsRef.current.set(newProp.id, newProp)
          setFlashIds(prev => new Set(prev).add(newProp.id))
          setTimeout(() => {
            setFlashIds(prev => {
              const next = new Set(prev)
              next.delete(newProp.id)
              return next
            })
          }, 2000)
        }

        setProps(Array.from(propsRef.current.values()))
        setLastUpdate(new Date())
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected')
        else if (status === 'CHANNEL_ERROR') setRealtimeStatus('error')
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Filter and sort
  const filtered = useMemo(() => {
    let result = props

    if (sport !== 'ALL') {
      result = result.filter(p => p.sport_id === sport)
    }
    if (statFilter !== 'ALL') {
      result = result.filter(p => p.stat_type === statFilter)
    }
    if (sourceFilter !== 'ALL') {
      result = result.filter(p => p.source === sourceFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        (p.player_name?.toLowerCase().includes(q)) ||
        (p.game_display?.toLowerCase().includes(q)) ||
        (p.team_abbr?.toLowerCase().includes(q))
      )
    }

    result.sort((a, b) => {
      let aVal: string | number, bVal: string | number
      switch (sortField) {
        case 'player_name': aVal = a.player_name || ''; bVal = b.player_name || ''; break
        case 'stat_type': aVal = a.stat_type || ''; bVal = b.stat_type || ''; break
        case 'stat_value': aVal = a.stat_value ?? 0; bVal = b.stat_value ?? 0; break
        case 'over_price': aVal = parsePrice(a.over_price); bVal = parsePrice(b.over_price); break
        case 'under_price': aVal = parsePrice(a.under_price); bVal = parsePrice(b.under_price); break
        case 'updated_at': aVal = a.updated_at; bVal = b.updated_at; break
        default: aVal = a.updated_at; bVal = b.updated_at;
      }
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })

    return result
  }, [props, sport, statFilter, sourceFilter, search, sortField, sortAsc])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }, [sortField, sortAsc])

  const sportCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: props.length }
    props.forEach(p => {
      counts[p.sport_id] = (counts[p.sport_id] || 0) + 1
    })
    return counts
  }, [props])

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: props.length }
    props.forEach(p => {
      const src = p.source || 'underdog'
      counts[src] = (counts[src] || 0) + 1
    })
    return counts
  }, [props])

  const statTypes = useMemo(() => {
    if (sport === 'ALL') return []
    return STAT_FILTERS[sport] || []
  }, [sport])

  const activeSources = useMemo(() => {
    const sources = new Set(props.map(p => p.source || 'underdog'))
    return Array.from(sources).sort()
  }, [props])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">📊 Props Dashboard</h1>
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                realtimeStatus === 'connected' ? 'bg-green-900/50 text-green-400' :
                realtimeStatus === 'error' ? 'bg-red-900/50 text-red-400' :
                'bg-yellow-900/50 text-yellow-400'
              }`}>
                {realtimeStatus === 'connected' ? '● LIVE' : realtimeStatus === 'error' ? '● ERROR' : '● CONNECTING'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>{filtered.length.toLocaleString()} lines</span>
              {lastUpdate && (
                <span>Updated {lastUpdate.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Source legend */}
          {activeSources.length > 1 && (
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-gray-500">Sources:</span>
              <button
                onClick={() => setSourceFilter('ALL')}
                className={`px-2 py-0.5 text-xs rounded ${
                  sourceFilter === 'ALL' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                All ({sourceCounts.ALL || 0})
              </button>
              {activeSources.map(src => {
                const colors = SOURCE_COLORS[src] || SOURCE_COLORS.underdog
                return (
                  <button
                    key={src}
                    onClick={() => setSourceFilter(src)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 text-xs rounded ${
                      sourceFilter === src ? `${colors.bg} ${colors.text}` : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    {colors.label} ({sourceCounts[src] || 0})
                  </button>
                )
              })}
            </div>
          )}

          {/* Sport tabs */}
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            {SPORTS.map(s => (
              <button
                key={s}
                onClick={() => { setSport(s); setStatFilter('ALL') }}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                  sport === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {s} <span className="text-xs opacity-70">({sportCounts[s] || 0})</span>
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search player, team, game..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-indigo-500"
            />
            {statTypes.length > 0 && (
              <select
                value={statFilter}
                onChange={e => setStatFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Stats</option>
                {statTypes.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </header>

      {/* Table */}
      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-lg">Loading props...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[140px] z-20">
                <tr className="bg-gray-900 border-b border-gray-800">
                  <th className="text-left px-3 py-2 text-gray-400 font-medium w-8">Src</th>
                  <SortHeader field="player_name" label="Player" current={sortField} asc={sortAsc} onClick={handleSort} />
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Game</th>
                  <SortHeader field="stat_type" label="Stat" current={sortField} asc={sortAsc} onClick={handleSort} />
                  <SortHeader field="stat_value" label="Line" current={sortField} asc={sortAsc} onClick={handleSort} className="text-right" />
                  <SortHeader field="over_price" label="Over" current={sortField} asc={sortAsc} onClick={handleSort} className="text-right" />
                  <SortHeader field="under_price" label="Under" current={sortField} asc={sortAsc} onClick={handleSort} className="text-right" />
                  <SortHeader field="updated_at" label="Updated" current={sortField} asc={sortAsc} onClick={handleSort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(prop => {
                  const source = prop.source || 'underdog'
                  const colors = SOURCE_COLORS[source] || SOURCE_COLORS.underdog
                  return (
                    <tr
                      key={prop.id}
                      onClick={() => setSelectedProp(prop)}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-all ${
                        flashIds.has(prop.id) ? 'animate-flash' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold ${colors.bg} ${colors.text}`}>
                          {colors.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-100">{prop.player_name || '—'}</div>
                        <div className="text-xs text-gray-500">{prop.sport_id}{prop.team_abbr ? ` · ${prop.team_abbr}` : ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{prop.game_display || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-xs">{prop.stat_type}</span>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-medium ${colors.text}`}>
                        {prop.stat_value ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        <PriceCell price={prop.over_price} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        <PriceCell price={prop.under_price} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">
                        {formatTime(prop.updated_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500">No lines found</div>
            )}
          </div>
        )}
      </main>

      {selectedProp && (
        <LineHistoryModal
          prop={selectedProp}
          onClose={() => setSelectedProp(null)}
        />
      )}
    </div>
  )
}

function SortHeader({ field, label, current, asc, onClick, className = '' }: {
  field: SortField; label: string; current: SortField; asc: boolean;
  onClick: (f: SortField) => void; className?: string
}) {
  const active = current === field
  return (
    <th
      className={`px-3 py-2 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none ${className}`}
      onClick={() => onClick(field)}
    >
      {label} {active ? (asc ? '↑' : '↓') : ''}
    </th>
  )
}

function PriceCell({ price }: { price: string | null }) {
  if (!price) return <span className="text-gray-600">—</span>
  const num = parseInt(price)
  const color = num > 0 ? 'text-green-400' : num < -150 ? 'text-red-400' : 'text-gray-300'
  return <span className={color}>{num > 0 ? '+' : ''}{price}</span>
}

function parsePrice(price: string | null): number {
  if (!price) return 0
  return parseInt(price) || 0
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}
