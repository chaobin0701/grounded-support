import assert from 'node:assert/strict';
import test from 'node:test';
import { groupModelProfiles, modelProfileStatus } from '../src/model-profile-presentation.ts';

test('model labels distinguish current, standby and disabled, without calling standby enabled', () => {
  assert.deepEqual(modelProfileStatus({ isDefault: true, enabled: true }), { key: 'current', label: '当前使用' });
  assert.deepEqual(modelProfileStatus({ isDefault: false, enabled: true }), { key: 'standby', label: '备用' });
  assert.deepEqual(modelProfileStatus({ isDefault: false, enabled: false }), { key: 'disabled', label: '已停用' });
});

test('current model gets its own first group regardless of API order, and stopped models come last', () => {
  const profiles = [
    { id: 1, isDefault: false, enabled: false },
    { id: 2, isDefault: false, enabled: true },
    { id: 3, isDefault: true, enabled: true },
    { id: 4, isDefault: false, enabled: true },
    { id: 5, isDefault: false, enabled: false },
  ];
  const groups = groupModelProfiles(profiles);
  assert.deepEqual(groups.map(group => group.key), ['current', 'other']);
  assert.deepEqual(groups[0].profiles.map(profile => profile.id), [3]);
  assert.deepEqual(groups[1].profiles.map(profile => profile.id), [2, 4, 1, 5]);
  assert.deepEqual(profiles.map(profile => profile.id), [1, 2, 3, 4, 5], 'must not mutate API response');
});

test('after activation the new current model moves to the first group and old model becomes standby', () => {
  const profiles = [{ id: 1, isDefault: true, enabled: true }, { id: 2, isDefault: false, enabled: true }];
  const switched = profiles.map(profile => ({ ...profile, isDefault: profile.id === 2 }));
  const groups = groupModelProfiles(switched);
  assert.equal(groups[0].profiles[0].id, 2);
  assert.equal(modelProfileStatus(groups[1].profiles[0]).label, '备用');
});

test('empty and only-current model lists never create empty groups', () => {
  assert.deepEqual(groupModelProfiles([]), []);
  assert.deepEqual(groupModelProfiles([{ isDefault: true, enabled: true }]).map(group => group.key), ['current']);
  assert.deepEqual(groupModelProfiles([{ isDefault: false, enabled: false }]).map(group => group.key), ['other']);
});
