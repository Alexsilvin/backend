// ============================================================
// User Types
// ============================================================

export type UserRole = 'admin' | 'player';

export interface UserRow {
  id: string;
  username: string;
  avatar_url: string | null;
  role: UserRole;
  email: string | null;
  password_hash?: string | null;
  password_salt?: string | null;
}

export interface AuthSessionResponse extends Omit<UserRow, 'password_hash' | 'password_salt'> {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  role: UserRole;
}

// ============================================================
// Game Types
// ============================================================

export interface GameRow {
  id: string;
  title: string;
  price: number;
  description: string;
  image: string;
  image_url?: string;
  category: string;
  platform?: string | null;
  publisher?: string | null;
  edition?: string | null;
  stock_quantity?: number | null;
  warehouse_zone?: string | null;
  discount_percent?: number;
  rom_storage_key: string | null;
  rom_filename: string | null;
  rom_size_bytes?: number | null;
  rom_sha256?: string | null;
  license_type?: string | null;
  is_downloadable: boolean;
  rating?: string;
  minSpecs?: Record<string, string>;
  recSpecs?: Record<string, string>;
}

export interface Game extends Omit<GameRow, 'password_hash' | 'password_salt'> {}

// ============================================================
// Bucket Types
// ============================================================

export interface BucketItem {
  user_id: string;
  game_id: string;
  added_at: string;
}

// ============================================================
// Friend Types
// ============================================================

export interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
}

// ============================================================
// Wallet Types
// ============================================================

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  payment_method_id?: string | null;
  transaction_type: string;
  amount: number;
  status: string;
  description?: string | null;
  created_at: string;
}

// ============================================================
// Message Types
// ============================================================

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface MessageGroup {
  id: string;
  name: string;
  description?: string | null;
  creator_id: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

// ============================================================
// API Response Types
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface DownloadUrlResponse {
  gameId: string;
  title: string;
  signedUrl: string;
  expiresInSeconds: number;
  userId?: string;
}

export interface RomUploadUrlResponse {
  gameId: string;
  title: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface RegisterRomResponse {
  game: {
    id: string;
    title: string;
    rom_storage_key: string;
    rom_filename: string;
    is_downloadable: boolean;
  };
}

export interface AdminOverviewResponse {
  summary: {
    totalUsers: number;
    adminUsers: number;
    playerUsers: number;
    totalGames: number;
  };
  recentUsers: UserRow[];
  recentGames: GameRow[];
}
