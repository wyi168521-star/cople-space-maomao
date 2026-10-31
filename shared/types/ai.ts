export type LoveQuoteInput = { coupleName: string; daysTogether: number }
export type DiaryMemory = { title: string; body?: string | null; location?: string | null; date?: string }
export type DailyDiaryInput = { memories: DiaryMemory[] }
export type AIResponse = { text: string; source: 'ai' }
export type AIFeature = 'quote' | 'diary'
