export type PackageJSONModifier = (
  absPath: string,
  packageJSON: Record<string, unknown>
) => Record<string, unknown> | null | undefined;

import Sync from './sync';

export default Sync;
