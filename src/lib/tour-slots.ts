import type { SupabaseClient } from '@supabase/supabase-js';

// tour_slots テーブルの行。AM/PM など slot_key ごとに「ラベル」「時刻」「並び順」を持つ。
// 将来 AM/PM が各複数コマになったときは slot_key="AM2" 等を追加して対応する。
export interface TourSlot {
  tour_slug: string;
  slot_key: string;
  label: string;
  time_label: string;
  display_order: number;
  is_active: boolean;
}

// 指定ツアーの有効スロット一覧を display_order 昇順で返す。
// tour_slots は RLS で公開読み取り可のため、呼び出し側のクライアント（anon / admin）に依存しない。
// クライアントコンポーネントからは @/lib/supabase（anon）、API ルートからは supabaseAdmin を渡すこと。
export async function getTourSlots(
  client: SupabaseClient,
  tourSlug: string
): Promise<TourSlot[]> {
  if (!tourSlug) return [];
  const { data, error } = await client
    .from('tour_slots')
    .select('tour_slug, slot_key, label, time_label, display_order, is_active')
    .eq('tour_slug', tourSlug)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[tour-slots] fetch error:', error);
    return [];
  }
  return (data ?? []) as TourSlot[];
}

// スロット配列から slot_key にマッチする { label, timeLabel } を返す。
// 見つからない場合は slot_key を label にフォールバック、timeLabel は空文字。
export function findTourSlot(
  slots: TourSlot[],
  slotKey: string
): { label: string; timeLabel: string } {
  const found = slots.find(s => s.slot_key === slotKey);
  if (!found) return { label: slotKey, timeLabel: '' };
  return { label: found.label, timeLabel: found.time_label };
}

// "{label}（{timeLabel}）" 形式に整形する。timeLabel が空なら label のみ返す。
export function formatSlotWithTime(label: string, timeLabel: string): string {
  if (!timeLabel) return label;
  return `${label}（${timeLabel}）`;
}
