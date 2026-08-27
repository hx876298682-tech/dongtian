/** 五行印记 */
import { elementMeta } from '../content/meta';

export function ElementTag({ elementKey }: { elementKey: string }) {
  if (!elementKey || /^(none|unknown|null|-)$/i.test(elementKey)) return null;
  const meta = elementMeta(elementKey);
  return <span className={`wx-tag ${meta.cls}`} title="五行">{meta.label}</span>;
}
