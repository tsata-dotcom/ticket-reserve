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
// Earliest bookable day = today + 2 days (inclusive).
// Latest bookable day = today + 1 month (inclusive).
export function getBookingDateRange(now: Date = new Date()): { minDate: Date; maxDate: Date } {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minDate = new Date(base);
  minDate.setDate(minDate.getDate() + 2);
  const maxDate = new Date(base);
  maxDate.setMonth(maxDate.getMonth() + 1);
  return { minDate, maxDate };
}

export function isWithinBookingRange(dateStr: string, now: Date = new Date()): boolean {
  const { minDate, maxDate } = getBookingDateRange(now);
  const d = new Date(dateStr + 'T00:00:00');
  return d >= minDate && d <= maxDate;
}
