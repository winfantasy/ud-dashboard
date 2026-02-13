'use client'

import { useEffect, useState, useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'

interface SportMapping {
  id: number
  canonical_name: string
  source: string
  source_sport_id: string
}

interface StatMapping {
  id: number
  canonical_name: string
  source: string
  source_stat_type: string
  sport_context: string | null
}

interface SourceSport {
  source: string
  sport_id: string
  count: number
}

export default function AdminPage() {
  const [sportMappings, setSportMappings] = useState<SportMapping[]>([])
  const [statMappings, setStatMappings] = useState<StatMapping[]>([])
  const [sourceSports, setSourceSports] = useState<SourceSport[]>([])
  const [sourceStats, setSourceStats] = useState<{ source: string; stat_type: string; sport_id: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'sports' | 'stats'>('sports')

  // New mapping form
  const [newCanonical, setNewCanonical] = useState('')
  const [selectedUnmapped, setSelectedUnmapped] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const supabase = getSupabase()

    // Load existing mappings
    const [sportRes, statRes] = await Promise.all([
      supabase.from('ud_sport_mappings').select('*').order('canonical_name'),
      supabase.from('ud_stat_mappings').select('*').order('canonical_name'),
    ])
    setSportMappings(sportRes.data || [])
    setStatMappings(statRes.data || [])

    // Load source sport counts via RPC or raw query
    const { data: sportCounts } = await supabase.rpc('get_sport_counts')
    if (sportCounts) {
      setSourceSports(sportCounts)
    } else {
      // Fallback: fetch from props
      const { data: props } = await supabase.from('ud_props').select('source, sport_id').limit(50000)
      if (props) {
        const counts = new Map<string, number>()
        props.forEach((p: { source: string; sport_id: string }) => {
          const key = `${p.source}||${p.sport_id}`
          counts.set(key, (counts.get(key) || 0) + 1)
        })
        setSourceSports(Array.from(counts.entries()).map(([k, count]) => {
          const [source, sport_id] = k.split('||')
          return { source, sport_id, count }
        }))
      }
    }

    // Load source stat counts
    const { data: props2 } = await supabase.from('ud_props').select('source, stat_type, sport_id').limit(50000)
    if (props2) {
      const counts = new Map<string, number>()
      props2.forEach((p: { source: string; stat_type: string; sport_id: string }) => {
        const key = `${p.source}||${p.stat_type}||${p.sport_id}`
        counts.set(key, (counts.get(key) || 0) + 1)
      })
      setSourceStats(Array.from(counts.entries()).map(([k, count]) => {
        const [source, stat_type, sport_id] = k.split('||')
        return { source, stat_type, sport_id, count }
      }))
    }

    setLoading(false)
  }

  // Group sport mappings by canonical name
  const sportGroups = useMemo(() => {
    const groups = new Map<string, SportMapping[]>()
    sportMappings.forEach(m => {
      const list = groups.get(m.canonical_name) || []
      list.push(m)
      groups.set(m.canonical_name, list)
    })
    return groups
  }, [sportMappings])

  // Find unmapped source sports
  const unmappedSports = useMemo(() => {
    const mapped = new Set(sportMappings.map(m => `${m.source}||${m.source_sport_id}`))
    return sourceSports
      .filter(s => !mapped.has(`${s.source}||${s.sport_id}`))
      .sort((a, b) => b.count - a.count)
  }, [sourceSports, sportMappings])

  // Group stat mappings by canonical name
  const statGroups = useMemo(() => {
    const groups = new Map<string, StatMapping[]>()
    statMappings.forEach(m => {
      const list = groups.get(m.canonical_name) || []
      list.push(m)
      groups.set(m.canonical_name, list)
    })
    return groups
  }, [statMappings])

  // Unmapped stats
  const unmappedStats = useMemo(() => {
    const mapped = new Set(statMappings.map(m => `${m.source}||${m.source_stat_type}||${m.sport_context || ''}`))
    return sourceStats
      .filter(s => !mapped.has(`${s.source}||${s.stat_type}||${s.sport_id}`))
      .sort((a, b) => b.count - a.count)
  }, [sourceStats, statMappings])

  const toggleUnmapped = (key: string) => {
    setSelectedUnmapped(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function createSportMapping() {
    if (!newCanonical.trim() || selectedUnmapped.size === 0) return

    const supabase = getSupabase()
    const rows = Array.from(selectedUnmapped).map(key => {
      const [source, sport_id] = key.split('||')
      return { canonical_name: newCanonical.trim(), source, source_sport_id: sport_id }
    })

    const { error } = await supabase.from('ud_sport_mappings').upsert(rows, { onConflict: 'source,source_sport_id' })
    if (error) {
      alert('Error: ' + error.message)
      return
    }

    setNewCanonical('')
    setSelectedUnmapped(new Set())
    loadData()
  }

  async function addToExistingGroup(canonicalName: string) {
    if (selectedUnmapped.size === 0) return

    const supabase = getSupabase()
    const rows = Array.from(selectedUnmapped).map(key => {
      const [source, sport_id] = key.split('||')
      return { canonical_name: canonicalName, source, source_sport_id: sport_id }
    })

    const { error } = await supabase.from('ud_sport_mappings').upsert(rows, { onConflict: 'source,source_sport_id' })
    if (error) {
      alert('Error: ' + error.message)
      return
    }

    setSelectedUnmapped(new Set())
    loadData()
  }

  async function deleteSportMapping(id: number) {
    const supabase = getSupabase()
    await supabase.from('ud_sport_mappings').delete().eq('id', id)
    loadData()
  }

  // Stat mapping functions
  const [newStatCanonical, setNewStatCanonical] = useState('')
  const [selectedUnmappedStats, setSelectedUnmappedStats] = useState<Set<string>>(new Set())

  const toggleUnmappedStat = (key: string) => {
    setSelectedUnmappedStats(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function createStatMapping() {
    if (!newStatCanonical.trim() || selectedUnmappedStats.size === 0) return

    const supabase = getSupabase()
    const rows = Array.from(selectedUnmappedStats).map(key => {
      const [source, stat_type, sport_id] = key.split('||')
      return { canonical_name: newStatCanonical.trim(), source, source_stat_type: stat_type, sport_context: sport_id || null }
    })

    const { error } = await supabase.from('ud_stat_mappings').upsert(rows, { onConflict: 'source,source_stat_type,sport_context' })
    if (error) {
      alert('Error: ' + error.message)
      return
    }

    setNewStatCanonical('')
    setSelectedUnmappedStats(new Set())
    loadData()
  }

  async function addStatToExistingGroup(canonicalName: string) {
    if (selectedUnmappedStats.size === 0) return

    const supabase = getSupabase()
    const rows = Array.from(selectedUnmappedStats).map(key => {
      const [source, stat_type, sport_id] = key.split('||')
      return { canonical_name: canonicalName, source, source_stat_type: stat_type, sport_context: sport_id || null }
    })

    const { error } = await supabase.from('ud_stat_mappings').upsert(rows, { onConflict: 'source,source_stat_type,sport_context' })
    if (error) {
      alert('Error: ' + error.message)
      return
    }

    setSelectedUnmappedStats(new Set())
    loadData()
  }

  async function deleteStatMapping(id: number) {
    const supabase = getSupabase()
    await supabase.from('ud_stat_mappings').delete().eq('id', id)
    loadData()
  }

  const SOURCE_COLORS: Record<string, string> = {
    underdog: 'text-yellow-400 bg-yellow-900/30',
    kalshi: 'text-green-400 bg-green-900/30',
    prizepicks: 'text-purple-400 bg-purple-900/30',
    draftkings: 'text-blue-400 bg-blue-900/30',
    fanduel: 'text-orange-400 bg-orange-900/30',
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading mappings...</div>
  }

  return (
    <div className="min-h-screen p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">🔗 Source Mappings</h1>
        <a href="/" className="text-sm text-indigo-400 hover:text-indigo-300">← Back to Dashboard</a>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('sports')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            tab === 'sports' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Sport Mappings ({sportMappings.length})
        </button>
        <button
          onClick={() => setTab('stats')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            tab === 'stats' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Stat Mappings ({statMappings.length})
        </button>
      </div>

      {tab === 'sports' && (
        <div className="space-y-6">
          {/* Existing groups */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Mapped Sports</h2>
            <div className="grid gap-3">
              {Array.from(sportGroups.entries()).map(([canonical, mappings]) => (
                <div key={canonical} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-white">{canonical}</h3>
                    {selectedUnmapped.size > 0 && (
                      <button
                        onClick={() => addToExistingGroup(canonical)}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                      >
                        + Add selected here
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mappings.map(m => (
                      <span key={m.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${SOURCE_COLORS[m.source] || 'text-gray-400 bg-gray-800'}`}>
                        <span className="font-medium">{m.source}</span>: {m.source_sport_id}
                        <button onClick={() => deleteSportMapping(m.id)} className="ml-1 text-red-400 hover:text-red-300">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Unmapped sports */}
          {unmappedSports.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">
                Unmapped Sports ({unmappedSports.length})
                {selectedUnmapped.size > 0 && <span className="text-sm text-indigo-400 ml-2">{selectedUnmapped.size} selected</span>}
              </h2>

              {/* Create new group */}
              {selectedUnmapped.size > 0 && (
                <div className="flex items-center gap-3 mb-4 p-3 bg-gray-900 rounded-lg border border-indigo-800">
                  <input
                    type="text"
                    placeholder="New canonical name (e.g. 'Soccer')"
                    value={newCanonical}
                    onChange={e => setNewCanonical(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm flex-1"
                    onKeyDown={e => e.key === 'Enter' && createSportMapping()}
                  />
                  <button
                    onClick={createSportMapping}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-500"
                  >
                    Create Group
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {unmappedSports.map(s => {
                  const key = `${s.source}||${s.sport_id}`
                  const selected = selectedUnmapped.has(key)
                  return (
                    <button
                      key={key}
                      onClick={() => toggleUnmapped(key)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        selected
                          ? 'border-indigo-500 bg-indigo-900/30'
                          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                      }`}
                    >
                      <div className={`text-xs mb-1 ${SOURCE_COLORS[s.source]?.split(' ')[0] || 'text-gray-400'}`}>
                        {s.source}
                      </div>
                      <div className="font-medium text-sm">{s.sport_id}</div>
                      <div className="text-xs text-gray-500">{s.count.toLocaleString()} props</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-6">
          {/* Existing stat groups */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Mapped Stats</h2>
            {statGroups.size === 0 ? (
              <p className="text-gray-500 text-sm">No stat mappings yet. Select unmapped stats below to create groups.</p>
            ) : (
              <div className="grid gap-3">
                {Array.from(statGroups.entries()).map(([canonical, mappings]) => (
                  <div key={canonical} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-white">{canonical}</h3>
                      {selectedUnmappedStats.size > 0 && (
                        <button
                          onClick={() => addStatToExistingGroup(canonical)}
                          className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                        >
                          + Add selected here
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {mappings.map(m => (
                        <span key={m.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${SOURCE_COLORS[m.source] || 'text-gray-400 bg-gray-800'}`}>
                          <span className="font-medium">{m.source}</span>: {m.source_stat_type}
                          {m.sport_context && <span className="text-gray-500">({m.sport_context})</span>}
                          <button onClick={() => deleteStatMapping(m.id)} className="ml-1 text-red-400 hover:text-red-300">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unmapped stats */}
          {unmappedStats.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">
                Unmapped Stats ({unmappedStats.length})
                {selectedUnmappedStats.size > 0 && <span className="text-sm text-indigo-400 ml-2">{selectedUnmappedStats.size} selected</span>}
              </h2>

              {selectedUnmappedStats.size > 0 && (
                <div className="flex items-center gap-3 mb-4 p-3 bg-gray-900 rounded-lg border border-indigo-800">
                  <input
                    type="text"
                    placeholder="New canonical stat name (e.g. 'Points')"
                    value={newStatCanonical}
                    onChange={e => setNewStatCanonical(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm flex-1"
                    onKeyDown={e => e.key === 'Enter' && createStatMapping()}
                  />
                  <button
                    onClick={createStatMapping}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-500"
                  >
                    Create Group
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[600px] overflow-y-auto">
                {unmappedStats.slice(0, 200).map(s => {
                  const key = `${s.source}||${s.stat_type}||${s.sport_id}`
                  const selected = selectedUnmappedStats.has(key)
                  return (
                    <button
                      key={key}
                      onClick={() => toggleUnmappedStat(key)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        selected
                          ? 'border-indigo-500 bg-indigo-900/30'
                          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                      }`}
                    >
                      <div className={`text-xs mb-1 ${SOURCE_COLORS[s.source]?.split(' ')[0] || 'text-gray-400'}`}>
                        {s.source} · {s.sport_id}
                      </div>
                      <div className="font-medium text-sm">{s.stat_type}</div>
                      <div className="text-xs text-gray-500">{s.count.toLocaleString()} props</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
