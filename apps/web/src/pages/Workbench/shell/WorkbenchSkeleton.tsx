import styles from "./WorkbenchSkeleton.module.css";

const blockSizeClassByKey = {
  "120x16": styles.block120x16,
  "80%x11": styles.block80p11,
  "40x40": styles.block40x40,
  "60%x11": styles.block60p11,
  "80%x10": styles.block80p10,
  "60x26": styles.block60x26,
  "80x26": styles.block80x26,
  "26x26": styles.block26x26,
  "120x26": styles.block120x26,
  "100%x32": styles.block100p32,
  "100%x28": styles.block100p28,
  "100%x42": styles.block100p42,
  "50%x14": styles.block50p14,
  "40%x11": styles.block40p11,
} as const;

const blockMarginClassByValue = {
  6: styles.mb6,
  8: styles.mb8,
  10: styles.mb10,
  20: styles.mb20,
} as const;

function Block({ w, h, mb = 0 }: { w: number | string; h: number; mb?: 0 | 6 | 8 | 10 | 20 }) {
  const key = `${w}x${h}` as keyof typeof blockSizeClassByKey;
  return (
    <div className={`${styles.block} ${blockSizeClassByKey[key]} ${mb ? blockMarginClassByValue[mb] : ""}`} />
  );
}

export function WorkbenchSkeleton() {
  return (
    <div className={styles.skeleton}>

      {/* 左侧 task list */}
      <div className={styles.leftPanel}>
        <Block w={120} h={16} mb={10} />
        <Block w="80%" h={11} mb={20} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.taskRow}>
            <Block w={40} h={40} />
            <div className={styles.taskMeta}>
              <Block w="60%" h={11} mb={6} />
              <Block w="80%" h={10} />
            </div>
          </div>
        ))}
      </div>

      {/* 中央 stage */}
      <div className={styles.stageShell}>
        <div className={styles.toolbar}>
          <Block w={60} h={26} />
          <Block w={80} h={26} />
          <Block w={26} h={26} />
          <Block w={26} h={26} />
          <div className={styles.toolbarSpacer} />
          <Block w={120} h={26} />
          <Block w={80} h={26} />
        </div>
        <div className={styles.stage}>
          <div className={styles.stagePreview} />
        </div>
        <div className={styles.footer}>
          <Block w="40%" h={11} />
        </div>
      </div>

      {/* 右侧 AI panel */}
      <div className={styles.rightPanel}>
        <Block w="50%" h={14} mb={10} />
        <Block w="100%" h={32} mb={10} />
        <Block w="100%" h={28} mb={20} />
        {Array.from({ length: 5 }).map((_, i) => (
          <Block key={i} w="100%" h={42} mb={8} />
        ))}
      </div>
    </div>
  );
}
