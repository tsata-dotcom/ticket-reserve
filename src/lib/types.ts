// DB-backed tour record (tour_types table)
export interface TourTypeRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  notice_text: string | null;
  price: number;
  is_first_free: boolean;
  max_per_booking: number;
  display_order: number;
  is_active: boolean;
  // is_listed=false のツアー（プレオープン等の招待制）はトップ一覧から除外する。
  // /[slug]/page.tsx の直リンクからは is_listed を見ずにアクセスできる。
  is_listed: boolean;
  // 予約可能期間モード（ステップ3.5）。null は従来動作（今日+2日〜今日+1ヶ月）。
  booking_range_mode: 'relative' | 'absolute' | null;
  booking_offset_start: number | null;
  booking_offset_end: number | null;
  // 開催期間（relative モード時の制約）。2099-12-31 は「実質無期限」のマジックナンバー。
  booking_start_date: string | null;
  booking_end_date: string | null;
}

export interface SiteContent {
  content_key: string;
  title: string | null;
  body: string | null;
}

// Slug→visual metadata map. Icon/color are not stored in the DB, so we
// augment records on the client. Unknown slugs fall back to a neutral theme.
export const TOUR_SLUG_META: Record<string, { icon: string; color: string; colorLight: string }> = {
  'karamuki-tour': { icon: '🦀', color: '#1a6985', colorLight: '#e8f4f8' },
  'original-kani': { icon: '🎨', color: '#6b4c8a', colorLight: '#f3eef8' },
};

const DEFAULT_META = { icon: '🎁', color: '#1a6985', colorLight: '#e8f4f8' };

// 表示名の解決は tour_types.name を参照する。
// 旧 toDisplayName 固定マップ（karamuki-tour / my-hp の2エントリ）は撤去済み。
// 呼び出し元では tour_types を SELECT して name を取得すること。

export interface TourUIRecord extends TourTypeRecord {
  icon: string;
  color: string;
  colorLight: string;
}

export function toTourUI(record: TourTypeRecord): TourUIRecord {
  return { ...record, ...(TOUR_SLUG_META[record.slug] || DEFAULT_META) };
}

export interface TimeSlotSetting {
  date: string;
  time_slot: 'AM' | 'PM';
  capacity: number;
  is_closed: boolean;
}

export interface DayAvailability {
  date: string;
  AM: { remaining: number; status: 'available' | 'few' | 'full' | 'closed' };
  PM: { remaining: number; status: 'available' | 'few' | 'full' | 'closed' };
}

export interface Reservation {
  id: string;
  order_no: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  visit_date: string;
  time_slot: 'AM' | 'PM';
  ticket_count: number;
  // Stores tour_types.slug for new reservations; legacy rows may hold a name.
  tour_type: string;
  unit_price: number;
  total_amount: number;
  customer_id: string;
  booking_source: string;
  status: string;
  checked_in: boolean;
  created_at: string;
  payment_method?: string | null;
  payment_authorization_id?: string | null;
  payment_authorized_at?: string | null;
  payment_captured_at?: string | null;
  payment_cancelled_at?: string | null;
  cancellation_fee?: number | null;
  // SBペイメント連携 (Phase 2)
  payment_status?: string | null;
  authorized_amount?: number | null;
  captured_amount?: number | null;
  is_first_visit?: boolean | null;
  cancel_policy_snapshot?: {
    '2days'?: number;
    '1day'?: number;
    today?: number;
  } | null;
}

export interface CustomerProfile {
  id: string;
  display_name: string;
  email: string;
  phone: string;
  futureshop_member_id?: string;
}

export interface FutureshopMemberInfo {
  memberId: string;
  lastName: string;
  firstName: string;
  mail: string;
  telNoMain: string;
}

// --- Date range for booking ---
// ステップ3.5: ツアーごとに予約可能期間モードを切り替えられるようにする。
//   - 'relative': booking_offset_start/end と booking_start_date/end_date の重なり
//   - 'absolute': time_slot_settings に行がある日（is_active=true）だけ
//   - null / 未指定: 従来の「今日+2日〜今日+1ヶ月」
export interface BookingRangeConfig {
  mode?: 'relative' | 'absolute' | null;
  offsetStart?: number | null;
  offsetEnd?: number | null;
  // YYYY-MM-DD
  startDate?: string | null;
  endDate?: string | null;
  // absolute モード用: time_slot_settings に行がある日付一覧（YYYY-MM-DD）
  absoluteDates?: string[];
}

// TourTypeRecord（または同等の DB 行）から BookingRangeConfig を作る。
// absoluteDates は呼び出し側で別途取得して詰める。
export function toBookingRangeConfig(
  tour: Pick<
    TourTypeRecord,
    'booking_range_mode' | 'booking_offset_start' | 'booking_offset_end' | 'booking_start_date' | 'booking_end_date'
  > | null | undefined,
  absoluteDates?: string[]
): BookingRangeConfig {
  if (!tour) return {};
  return {
    mode: tour.booking_range_mode ?? null,
    offsetStart: tour.booking_offset_start ?? null,
    offsetEnd: tour.booking_offset_end ?? null,
    startDate: tour.booking_start_date ?? null,
    endDate: tour.booking_end_date ?? null,
    absoluteDates,
  };
}

function parseYmd(s: string): Date {
  return new Date(s.slice(0, 10) + 'T00:00:00');
}

const DEFAULT_OFFSET_START = 2;
const DEFAULT_OFFSET_END_DAYS = 30; // 今日+1ヶ月 ≒ +30日のフォールバック

export function getBookingDateRange(
  config?: BookingRangeConfig,
  now: Date = new Date()
): { minDate: Date; maxDate: Date } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 従来動作フォールバック: mode 未指定の場合は今日+2日〜今日+1ヶ月
  if (!config || !config.mode) {
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + DEFAULT_OFFSET_START);
    const maxDate = new Date(today);
    maxDate.setMonth(maxDate.getMonth() + 1);
    return { minDate, maxDate };
  }

  if (config.mode === 'absolute') {
    const dates = (config.absoluteDates ?? [])
      .map(d => parseYmd(d))
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length === 0) {
      // 日付未登録 — UI 表示用に今日を返す（isWithinBookingRange 側は集合判定なので影響なし）
      return { minDate: today, maxDate: today };
    }
    return { minDate: dates[0], maxDate: dates[dates.length - 1] };
  }

  // relative
  const offsetStart = config.offsetStart ?? DEFAULT_OFFSET_START;
  const offsetEnd = config.offsetEnd ?? DEFAULT_OFFSET_END_DAYS;

  const offsetMin = new Date(today);
  offsetMin.setDate(offsetMin.getDate() + offsetStart);
  const offsetMax = new Date(today);
  offsetMax.setDate(offsetMax.getDate() + offsetEnd);

  const periodMin = config.startDate ? parseYmd(config.startDate) : null;
  const periodMax = config.endDate ? parseYmd(config.endDate) : null;

  // 開催期間とオフセット範囲の重なりを取る
  const minDate = periodMin && periodMin > offsetMin ? periodMin : offsetMin;
  const maxDate = periodMax && periodMax < offsetMax ? periodMax : offsetMax;

  return { minDate, maxDate };
}

export function isWithinBookingRange(
  dateStr: string,
  config?: BookingRangeConfig,
  now: Date = new Date()
): boolean {
  const ymd = dateStr.slice(0, 10);
  if (config?.mode === 'absolute') {
    return (config.absoluteDates ?? []).includes(ymd);
  }
  const { minDate, maxDate } = getBookingDateRange(config, now);
  const d = parseYmd(ymd);
  return d >= minDate && d <= maxDate;
}
