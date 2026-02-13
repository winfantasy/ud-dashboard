export interface Prop {
  id: string
  appearance_id: string | null
  player_id: string | null
  game_id: string | null
  sport_id: string
  stat_type: string
  stat_display: string | null
  stat_value: number | null
  over_price: string | null
  under_price: string | null
  over_decimal: number | null
  under_decimal: number | null
  line_type: string
  status: string
  choice_display: string | null
  player_name: string | null
  team_abbr: string | null
  game_display: string | null
  first_seen_at: string
  updated_at: string
}

export interface LineHistory {
  id: number
  prop_id: string
  appearance_id: string | null
  stat_value: number | null
  over_price: string | null
  under_price: string | null
  over_decimal: number | null
  under_decimal: number | null
  event_type: string
  recorded_at: string
}

export interface Player {
  id: string
  first_name: string
  last_name: string
  sport_id: string
  team_name: string | null
  position: string | null
  image_url: string | null
}
