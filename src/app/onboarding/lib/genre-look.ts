/**
 * Each of the 16 genres' icon and colour (the colour lights the row and the icon). One look for the genre screen
 * (components/GenreStep.tsx) and the Taste DNA page's genre rows (P2-U8).
 */
import {
  Drama, Flame, Flower2, Ghost, Laugh, Origami, Rabbit, Rocket, Search, Siren, Swords, ToyBrick, Tv, Video, WandSparkles, Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Genre16 } from '@/app/play/lib/genres16'

export const LOOK: Record<Genre16, { icon: LucideIcon; colour: string }> = {
  comedy:    { icon: Laugh,        colour: '#ffad33' },
  drama:     { icon: Drama,        colour: '#a565d8' },
  action:    { icon: Flame,        colour: '#e5533c' },
  crime:     { icon: Siren,        colour: '#8aa0bd' },
  thriller:  { icon: Search,       colour: '#8e44ad' },
  scifi:     { icon: Rocket,       colour: '#3a8fd9' },
  fantasy:   { icon: WandSparkles, colour: '#6a5acd' },
  hero:      { icon: Zap,          colour: '#d63a55' },
  horror:    { icon: Ghost,        colour: '#c0392b' },
  romance:   { icon: Flower2,      colour: '#ee2d8f' },
  adultanim: { icon: Tv,           colour: '#f2c94c' },
  anim:      { icon: Rabbit,       colour: '#1fbf9c' },
  family:    { icon: ToyBrick,     colour: '#7cc96b' },
  anime:     { icon: Origami,      colour: '#d42fb0' },
  doc:       { icon: Video,        colour: '#b9a24a' },
  war:       { icon: Swords,       colour: '#8b7d62' },
}
