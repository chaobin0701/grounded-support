type ProfileState = { isDefault: boolean; enabled: boolean };

export function modelProfileStatus(profile: ProfileState) {
  if (profile.isDefault) return { key: 'current', label: '当前使用' } as const;
  if (profile.enabled) return { key: 'standby', label: '备用' } as const;
  return { key: 'disabled', label: '已停用' } as const;
}

export function groupModelProfiles<T extends ProfileState>(profiles: readonly T[]) {
  return [
    { key: 'current', title: '当前模型', description: '用于后续对话请求', profiles: profiles.filter(profile => profile.isDefault) },
    {
      key: 'other', title: '其他配置', description: '备用配置需手动设为当前，不会自动切换。',
      profiles: [
        ...profiles.filter(profile => !profile.isDefault && profile.enabled),
        ...profiles.filter(profile => !profile.isDefault && !profile.enabled),
      ],
    },
  ].filter(group => group.profiles.length > 0);
}
