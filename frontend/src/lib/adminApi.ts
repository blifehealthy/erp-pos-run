import type { ApiResponse } from "@/types/api";
import type { BranchDetail, BranchReplacementRule, BranchSettings, InviteResponse, RoleDetail, UserDetail } from "@/types/admin";
import api from "./api";

export const userApi = {
  list: (params?: {
    branch_id?: string;
    is_active?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) => api.get<ApiResponse<UserDetail[]>>("/system/users", { params }),
  get: (id: string) => api.get<ApiResponse<UserDetail>>(`/system/users/${id}`),
  create: (data: object) => api.post<ApiResponse<UserDetail>>("/system/users", data),
  update: (id: string, data: object) => api.patch<ApiResponse<UserDetail>>(`/system/users/${id}`, data),
  deactivate: (id: string) => api.post<ApiResponse<UserDetail>>(`/system/users/${id}/deactivate`),
  changePassword: (id: string, newPassword: string) =>
    api.post<ApiResponse<{ message: string }>>(`/system/users/${id}/change-password`, {
      new_password: newPassword
    }),
  assignBranch: (id: string, data: { branch_id: string; role_id: string; is_default?: boolean }) =>
    api.post<ApiResponse<UserDetail>>(`/system/users/${id}/branches`, data),
  removeBranch: (userId: string, branchId: string) =>
    api.delete(`/system/users/${userId}/branches/${branchId}`)
};

export const roleApi = {
  list: () => api.get<ApiResponse<RoleDetail[]>>("/system/roles"),
  create: (data: { name: string; description?: string; permission_ids: string[] }) =>
    api.post<ApiResponse<RoleDetail>>("/system/roles", data),
  update: (id: string, data: object) => api.patch<ApiResponse<RoleDetail>>(`/system/roles/${id}`, data),
  delete: (id: string) => api.delete(`/system/roles/${id}`)
};

export const branchApi = {
  list: () => api.get<ApiResponse<BranchDetail[]>>("/system/branches"),
  get: (id: string) => api.get<ApiResponse<BranchDetail>>(`/system/branches/${id}`),
  create: (data: object) => api.post<ApiResponse<BranchDetail>>("/system/branches", data),
  update: (id: string, data: object) => api.patch<ApiResponse<BranchDetail>>(`/system/branches/${id}`, data),
  getSettings: (id: string) => api.get<ApiResponse<BranchSettings>>(`/system/branches/${id}/settings`),
  updateSettings: (id: string, data: object) =>
    api.patch<ApiResponse<BranchSettings>>(`/system/branches/${id}/settings`, data),
  listReplacementRules: (id: string) =>
    api.get<ApiResponse<BranchReplacementRule[]>>(`/system/branches/${id}/replacement-rules`),
  upsertReplacementRule: (id: string, data: { source_product_id: string; replacement_product_id: string }) =>
    api.post<ApiResponse<BranchReplacementRule>>(`/system/branches/${id}/replacement-rules`, data),
  deleteReplacementRule: (id: string, sourceProductId: string) =>
    api.delete(`/system/branches/${id}/replacement-rules/${sourceProductId}`)
};

export const invitationApi = {
  create: (data: object) => api.post<ApiResponse<InviteResponse>>("/system/invitations", data),
  accept: (
    data: { otp_code: string; username: string; password: string },
    companyId: string
  ) =>
    api.post<ApiResponse<{ message: string }>>("/system/invitations/accept", data, {
      headers: { "X-Company-ID": companyId }
    })
};
