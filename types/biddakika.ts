// types/biddakika.ts

export type UserRole = "guest" | "hotel" | "agency" | "admin";

export interface GuestProfile {
  phone?: string;
  country?: string;
}

export interface HotelProfile {
  hotelName: string;
  address: string;
  phone: string;
  website?: string;
  starRating?: number; // 1–5
  propertyType: "hotel" | "butik" | "pansiyon" | "apart" | "villa" | "hostel";
  boardTypes: string[]; // RO, BB, HB, FB, AI, UAI...
  features: string[]; // pool, parking, wifi, seaView, spa...
  
}

export interface AgencyProfile {
  agencyName: string;
  address: string;
  phone: string;
  website?: string;
  description?: string;
}

export interface BkUser {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  guestProfile?: GuestProfile;
  hotelProfile?: HotelProfile;
  agencyProfile?: AgencyProfile;
}
