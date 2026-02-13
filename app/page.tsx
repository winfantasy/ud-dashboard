'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { Prop } from '@/lib/types'
import LineHistoryModal from '@/components/LineHistoryModal'

const SPORTS_PRIORITY = ['ALL', 'NBA', '3PT', 'DUNK', 'THREE_PT', 'CBB', 'NHL', 'MLB', 'PGA', 'MMA', 'SOCCER', 'TENNIS', 'UNRIVALED', 'OLYMPICS']

const SOURCE_META: Record<string, { bg: string; text: string; dot: string; label: string; color: string }> = {
  underdog: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', dot: 'bg-yellow-400', label: 'UD', color: '#facc15' },
  kalshi: { bg: 'bg-green-900/30', text: 'text-green-400', dot: 'bg-green-400', label: 'KAL', color: '#4ade80' },
  draftkings: { bg: 'bg-blue-900/30', text: 'text-blue-400', dot: 'bg-blue-400', label: 'DK', color: '#60a5fa' },
  prizepicks: { bg: 'bg-purple-900/30', text: 'text-purple-400', dot: 'bg-purple-400', label: 'PP', color: '#c084fc' },
  fanduel: { bg: 'bg-orange-900/30', text: 'text-orange-400', dot: 'bg-orange-400', label: 'FD', color: '#fb923c' },
}

const SOURCES_ORDER = ['underdog', 'kalshi', 'prizepicks', 'draftkings', 'fanduel']

// Merged row: one per player+stat, with per-source data
interface MergedRow {
  key: string
  player_name: string
  sport_id: string
  stat_type: string
  game_display: string
  team_abbr: string
  sources: Record<string, { line: number | null; over: string | null; under: string | null; updated_at: string; prop: Prop }>
  latestUpdate: string
}

type SortField = 'player_name' | 'stat_type' | 'line' | 'updated_at'

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
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set())
  const [sourcesEnabled, setSourcesEnabled] = useState<Record<string, boolean>>({})
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
        .limit(20000)

      if (error) {
        console.error('Fetch error:', error)
        setLoading(false)
        return
      }

      const propsList = (data || []) as Prop[]
      setProps(propsList)
      propsRef.current = new Map(propsList.map(p => [p.id, p]))

      // Init all found sources as enabled
      const srcs: Record<string, boolean> = {}
      propsList.forEach(p => { srcs[p.source || 'underdog'] = true })
      setSourcesEnabled(srcs)

      setLastUpdate(new Date())
      setLoading(false)
    }
    fetchProps()
  }, [])

  // Subscribe to realtime
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
          const mergeKey = makeMergeKey(newProp)
          setFlashKeys(prev => new Set(prev).add(mergeKey))
          setTimeout(() => {
            setFlashKeys(prev => { const next = new Set(prev); next.delete(mergeKey); return next })
          }, 2000)

          // Enable new source if first time
          const src = newProp.source || 'underdog'
          setSourcesEnabled(prev => prev[src] ? prev : { ...prev, [src]: true })
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

  // Active sources (ordered)
  const activeSources = useMemo(() => {
    return SOURCES_ORDER.filter(s => sourcesEnabled[s])
  }, [sourcesEnabled])

  // Normalize player name for matching
  const normName = (name: string | null) => {
    if (!name) return ''
    return name.toLowerCase().trim()
      .replace(/[.\-']/g, '')
      .replace(/\s+/g, ' ')
  }

  // Normalize stat type for matching
  const normStat = (stat: string) => {
    return stat.toLowerCase().trim()
      .replace(/three pointers made/i, '3-pointers made')
      .replace(/3-pointers/i, '3-pointers')
      .replace(/pts \+ reb \+ ast/i, 'pts + rebs + asts')
      .replace(/pts \+ rebs \+ asts/i, 'pts + rebs + asts')
  }

  // Merge key for grouping
  function makeMergeKey(p: Prop): string {
    return `${normName(p.player_name)}||${normStat(p.stat_type)}||${p.sport_id}`
  }

  // Merge props into rows
  const merged = useMemo(() => {
    const map = new Map<string, MergedRow>()

    for (const p of props) {
      const src = p.source || 'underdog'
      // Filter by enabled sources
      if (!sourcesEnabled[src]) continue

      const key = makeMergeKey(p)
      let row = map.get(key)
      if (!row) {
        row = {
          key,
          player_name: p.player_name || '—',
          sport_id: p.sport_id,
          stat_type: p.stat_type,
          game_display: p.game_display || '—',
          team_abbr: p.team_abbr || '',
          sources: {},
          latestUpdate: p.updated_at,
        }
        map.set(key, row)
      }

      // Keep best data per source (latest update wins)
      if (!row.sources[src] || p.updated_at > row.sources[src].updated_at) {
        row.sources[src] = {
          line: p.stat_value,
          over: p.over_price,
          under: p.under_price,
          updated_at: p.updated_at,
          prop: p,
        }
      }

      if (p.updated_at > row.latestUpdate) {
        row.latestUpdate = p.updated_at
        row.game_display = p.game_display || row.game_display
      }
    }

    return Array.from(map.values())
  }, [props, sourcesEnabled])

  // Filter and sort merged rows
  const filtered = useMemo(() => {
    let result = merged

    if (sport !== 'ALL') {
      result = result.filter(r => r.sport_id === sport)
    }
    if (statFilter !== 'ALL') {
      result = result.filter(r => r.stat_type === statFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.player_name.toLowerCase().includes(q) ||
        r.game_display.toLowerCase().includes(q) ||
        r.team_abbr.toLowerCase().includes(q)
      )
    }

    result.sort((a, b) => {
      let aVal: string | number, bVal: string | number
      switch (sortField) {
        case 'player_name': aVal = a.player_name; bVal = b.player_name; break
        case 'stat_type': aVal = a.stat_type; bVal = b.stat_type; break
        case 'line': {
          // Sort by first available line
          const aLine = Object.values(a.sources)[0]?.line ?? 0
          const bLine = Object.values(b.sources)[0]?.line ?? 0
          aVal = aLine; bVal = bLine; break
        }
        case 'updated_at': aVal = a.latestUpdate; bVal = b.latestUpdate; break
        default: aVal = a.latestUpdate; bVal = b.latestUpdate;
      }
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })

    return result
  }, [merged, sport, statFilter, search, sortField, sortAsc])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }, [sortField, sortAsc])

  const sportCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: merged.length }
    merged.forEach(r => { counts[r.sport_id] = (counts[r.sport_id] || 0) + 1 })
    return counts
  }, [merged])

  // Dynamic sports list: prioritized order, then any extras alphabetically
  const sportTabs = useMemo(() => {
    const activeSports = Object.keys(sportCounts).filter(s => s !== 'ALL' && sportCounts[s] > 0)
    const ordered = SPORTS_PRIORITY.filter(s => s === 'ALL' || activeSports.includes(s))
    const extras = activeSports.filter(s => !SPORTS_PRIORITY.includes(s)).sort()
    return [...ordered, ...extras]
  }, [sportCounts])

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    props.forEach(p => {
      const src = p.source || 'underdog'
      counts[src] = (counts[src] || 0) + 1
    })
    return counts
  }, [props])

  // Stat types for current sport
  const statTypes = useMemo(() => {
    if (sport === 'ALL') return []
    const stats = new Set<string>()
    merged.filter(r => r.sport_id === sport).forEach(r => stats.add(r.stat_type))
    return Array.from(stats).sort()
  }, [sport, merged])

  // How many sources does each row have?
  const multiSourceCount = useMemo(() => {
    return filtered.filter(r => Object.keys(r.sources).length > 1).length
  }, [filtered])

  const toggleSource = (src: string) => {
    setSourcesEnabled(prev => ({ ...prev, [src]: !prev[src] }))
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="max-w-[1800px] mx-auto">
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
              <span>{filtered.length.toLocaleString()} rows</span>
              {multiSourceCount > 0 && (
                <span className="text-indigo-400">{multiSourceCount} cross-source</span>
              )}
              {lastUpdate && (
                <span>Updated {lastUpdate.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Source toggles */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-gray-500">Sources:</span>
            {SOURCES_ORDER.filter(s => sourceCounts[s]).map(src => {
              const meta = SOURCE_META[src]
              const enabled = sourcesEnabled[src]
              return (
                <button
                  key={src}
                  onClick={() => toggleSource(src)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all ${
                    enabled
                      ? `${meta.bg} ${meta.text} border-current`
                      : 'text-gray-600 border-gray-800 opacity-50'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${enabled ? meta.dot : 'bg-gray-700'}`} />
                  {meta.label} ({(sourceCounts[src] || 0).toLocaleString()})
                </button>
              )
            })}
          </div>

          {/* Sport tabs */}
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            {sportTabs.map(s => (
              <button
                key={s}
                onClick={() => { setSport(s); setStatFilter('ALL') }}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                  sport === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {s} {sportCounts[s] ? <span className="text-xs opacity-70">({sportCounts[s]})</span> : ''}
              </button>
            ))}
          </div>

          {/* Filters */}
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
      <main className="max-w-[1800px] mx-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-lg">Loading props...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[160px] z-20">
                <tr className="bg-gray-900 border-b border-gray-800">
                  <SortHeader field="player_name" label="Player" current={sortField} asc={sortAsc} onClick={handleSort} />
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Game</th>
                  <SortHeader field="stat_type" label="Stat" current={sortField} asc={sortAsc} onClick={handleSort} />
                  {/* One column group per active source */}
                  {activeSources.map(src => {
                    const meta = SOURCE_META[src]
                    return (
                      <th key={src} colSpan={3} className={`px-1 py-2 text-center border-l border-gray-800 ${meta.text}`}>
                        <span className="text-xs font-bold">{meta.label}</span>
                      </th>
                    )
                  })}
                  <SortHeader field="updated_at" label="Updated" current={sortField} asc={sortAsc} onClick={handleSort} className="text-right" />
                </tr>
                <tr className="bg-gray-900/80 border-b border-gray-800">
                  <th className="px-3 py-1"></th>
                  <th className="px-3 py-1"></th>
                  <th className="px-3 py-1"></th>
                  {activeSources.map(src => (
                    <SubHeaders key={src} />
                  ))}
                  <th className="px-3 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const numSources = Object.keys(row.sources).length
                  return (
                    <tr
                      key={row.key}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/50 transition-all ${
                        flashKeys.has(row.key) ? 'animate-flash' : ''
                      } ${numSources > 1 ? 'bg-gray-900/30' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-100">{row.player_name}</div>
                        <div className="text-xs text-gray-500">
                          {row.sport_id}{row.team_abbr ? ` · ${row.team_abbr}` : ''}
                          {numSources > 1 && (
                            <span className="ml-1.5 text-indigo-400">({numSources} sources)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs max-w-[160px] truncate">{row.game_display}</td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-xs">{row.stat_type}</span>
                      </td>
                      {activeSources.map(src => {
                        const d = row.sources[src]
                        const meta = SOURCE_META[src]
                        if (!d) {
                          return (
                            <td key={`${src}-line`} colSpan={3} className="px-1 py-2.5 text-center border-l border-gray-800">
                              <span className="text-gray-700 text-xs">—</span>
                            </td>
                          )
                        }
                        return [
                          <td key={`${src}-line`} className={`px-2 py-2.5 text-right font-mono font-medium border-l border-gray-800 ${meta.text}`}
                              onClick={() => setSelectedProp(d.prop)}
                              style={{ cursor: 'pointer' }}
                          >
                            {d.line ?? '—'}
                          </td>,
                          <td key={`${src}-over`} className="px-1 py-2.5 text-right font-mono text-xs"
                              onClick={() => setSelectedProp(d.prop)}
                              style={{ cursor: 'pointer' }}
                          >
                            <PriceCell price={d.over} />
                          </td>,
                          <td key={`${src}-under`} className="px-1 py-2.5 text-right font-mono text-xs"
                              onClick={() => setSelectedProp(d.prop)}
                              style={{ cursor: 'pointer' }}
                          >
                            <PriceCell price={d.under} />
                          </td>,
                        ]
                      })}
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">
                        {formatTime(row.latestUpdate)}
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

function SubHeaders() {
  return (
    <>
      <th className="px-2 py-1 text-[10px] text-gray-500 font-normal text-right border-l border-gray-800">Line</th>
      <th className="px-1 py-1 text-[10px] text-gray-500 font-normal text-right">O</th>
      <th className="px-1 py-1 text-[10px] text-gray-500 font-normal text-right">U</th>
    </>
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
  if (!price) return <span className="text-gray-700">—</span>
  const num = parseInt(price)
  const color = num > 0 ? 'text-green-400' : num < -150 ? 'text-red-400' : 'text-gray-300'
  return <span className={color}>{num > 0 ? '+' : ''}{price}</span>
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
