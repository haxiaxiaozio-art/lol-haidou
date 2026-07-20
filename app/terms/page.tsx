import Link from "next/link";
import styles from "../legal.module.css";

export default function TermsPage() {
  return <main className={styles.shell}>
    <Link className={styles.back} href="/">← 返回海斗战报</Link>
    <h1>使用边界</h1>
    <p>本页面提供第三方赛后统计实验，不代表官方竞技排名。</p>
    <div className={styles.content}>
      <h2>允许用途</h2>
      <p>导入自己有权使用的比赛数据，查看职业维度、死亡规则、英雄表现和数据高光局。</p>
      <h2>不提供的能力</h2>
      <ul><li>不提供实时对局侦察或敌方信息。</li><li>不展示海克斯胜率或对局内必选建议。</li><li>不将操作总分描述为官方段位、MMR 或 ELO。</li></ul>
      <h2>演示评分</h2>
      <p>当前使用固定职业基线，适合验证交互与算法结构，不适合作为跨玩家公开排行依据。</p>
    </div>
  </main>;
}
