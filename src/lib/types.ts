export type TourType = '殻むき体験ツアー' | 'My HPづくり';

export interface TourInfo {
  name: TourType;
  icon: string;
  color: string;
  colorLight: string;
  duration: string;
  price: number;
}

export const TOURS: TourInfo[] = [
  {
    name: '殻むき体験ツアー',
    icon: '🦀',
    color: '#1a6985',
    colorLight: '#e8f4f8',
    duration: '約60分',
    price: 3000,
  },
  {
    name: 'My HPづくり',
    icon: '🎨',
    color: '#6b4c8a',
    colorLight: '#f3eef8',
    duration: '約90分',
    price: 3500,
  },
];

export interface TimeSlotSetting {
  date: string;
  time_slot: 'morning' | 'afternoon';
  capacity: number;
  is_closed: boolean;
}

export interface DayAvailability {
  date: string;
  morning: { remaining: number; status: 'available' | 'few' | 'full' | 'closed' };
  afternoon: { remaining: number; status: 'available' | 'few' | 'full' | 'closed' };
}

export interface Reservation {
  id: string;
  order_no: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  visit_date: string;
  time_slot: 'morning' | 'afternoon';
  ticket_count: number;
  tour_type: TourType;
  unit_price: number;
  total_amount: number;
  customer_id: string;
  booking_source: string;
  status: string;
  checked_in: boolean;
  created_at: string;
}

export interface CustomerProfile {
  id: string;
  user_id: string;
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
