export interface AdminPrincipal {
  id: number;
  email: string | null;
  username?: string | null;
  displayName: string;
}

export interface AdminRequest {
  headers: { authorization?: string };
  admin?: AdminPrincipal;
}
