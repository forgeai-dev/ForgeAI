export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  isActive: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPermission {
  userId: string;
  resource: string;
  action: PermissionAction;
  allowed: boolean;
}

export type PermissionAction = 'read' | 'write' | 'execute' | 'delete' | 'admin';

export interface AuthToken {
  token: string;
  userId: string;
  expiresAt: Date;
  refreshToken?: string;
}
