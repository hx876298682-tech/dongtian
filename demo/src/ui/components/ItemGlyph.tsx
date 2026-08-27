/** 器物剪影：六槽位程序化占位（品质色描边）。正式立绘到位前统一走此规范。 */

export function ItemGlyph({ slot, size = 34 }: { slot: string; size?: number }) {
  const kind = slot.startsWith('armor') ? 'armor' : slot === 'accessory' ? 'accessory' : 'weapon';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === 'weapon' && (
        <>
          <path d="M12.5 3.5 19 10l-8.2 8.2-1.6-1.6L3 10.8 11.2 2.6z" transform="rotate(45 12 12)" />
          <path d="m14 15 4 4" />
        </>
      )}
      {kind === 'armor' && (
        <>
          <path d="M12 3l7 2.5v6c0 4.4-3 7.7-7 9.5-4-1.8-7-5.1-7-9.5v-6z" />
          <path d="M12 3v18" />
        </>
      )}
      {kind === 'accessory' && (
        <>
          <circle cx="12" cy="13" r="7" />
          <circle cx="12" cy="13" r="3.2" />
          <path d="M9 4.5 12 3l3 1.5" />
        </>
      )}
    </svg>
  );
}
