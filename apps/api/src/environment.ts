import { parseEnvironment } from '@dongtian/config-schema';

export const environmentToken = Symbol('environment');

export const environmentProvider = {
  provide: environmentToken,
  useFactory: () => parseEnvironment(process.env),
};
