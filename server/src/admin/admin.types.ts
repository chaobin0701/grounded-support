export interface AdminPrincipal {
  id: number;
  email: string;
  displayName: string;
}

export interface AdminRequest {
  headers: { authorization?: string };
  admin?: AdminPrincipal;
}
