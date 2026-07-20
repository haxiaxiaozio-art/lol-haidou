import styles from "../legal.module.css";

export default function TermsPage() {
  return <main className={styles.shell}>
    <a className={styles.back} href="../">← 返回海斗战报</a>
    <h1>使用边界</h1>
    <p>本页面提供第三方赛后统计实验，不代表 Riot Games、腾讯游戏或英雄联盟官方结论。</p>
    <div className={styles.content}>
      <h2>操作评分</h2>
      <p>操作总分根据英雄职业、对局数据和死亡规则计算，用于个人复盘。它不参与海斗估算分，也不等同于段位、MMR 或 ELO。</p>
      <h2>海斗估算分</h2>
      <p>海斗估算分只依据胜负、参赛双方当时的估算强度、样本覆盖和不确定性结算。它是一般稳定的趋势估计，不是 Riot 官方隐藏分，也不能保证反映实际匹配系统。</p>
      <h2>不提供的能力</h2>
      <ul><li>不提供实时对局侦察或敌方信息。</li><li>不展示海克斯胜率或对局内必选建议。</li><li>不把第三方估算用于官方段位判断或公开竞技排名。</li></ul>
      <h2>数据来源</h2>
      <p>真实战绩读取依赖玩家本机已登录的 LOL 客户端。客户端接口变化、历史数据缺失或网络评分服务不可用时，结果可能不完整。</p>
    </div>
  </main>;
}
