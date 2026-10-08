import volcengineLogo from '@lobehub/icons-static-svg/icons/volcengine-color.svg?url';
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url';
import deepseekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';

export type ModelPlatformKey = 'volcengine' | 'openai' | 'deepseek' | 'custom';

export const modelPlatforms = {
  volcengine: {
    label: '火山引擎方舟',
    description: '方舟模型服务',
    logo: volcengineLogo,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v4-1-flash-260910',
    defaultName: '火山引擎主模型',
  },
  openai: {
    label: 'OpenAI',
    description: '官方模型服务',
    logo: openaiLogo,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    defaultName: 'OpenAI 主模型',
  },
  deepseek: {
    label: 'DeepSeek',
    description: '官方模型服务',
    logo: deepseekLogo,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    defaultName: 'DeepSeek 主模型',
  },
  custom: {
    label: '其他兼容平台',
    description: '自定义接口地址',
    logo: null,
    baseUrl: '',
    model: '',
    defaultName: '自定义兼容模型',
  },
} satisfies Record<ModelPlatformKey, {
  label: string;
  description: string;
  logo: string | null;
  baseUrl: string;
  model: string;
  defaultName: string;
}>;

export const modelPlatformOptions = (Object.keys(modelPlatforms) as ModelPlatformKey[])
  .map((key) => ({ key, ...modelPlatforms[key] }));
