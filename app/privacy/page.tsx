import Link from "next/link";
import styles from "../legal.module.css";

export default function PrivacyPage() {
  return <main className={styles.shell}>
    <Link className={styles.back} href="/">← 返回海斗战报</Link>
    <h1>隐私说明</h1>
    <p>这是一个本地 MVP，帮助你验证海斗数据导入和评分体验。</p>
    <div className={styles.content}>
      <h2>数据处理</h2>
      <p>你选择的 CSV 或 JSON 文件仅在当前浏览器页面中读取和计算。本版本不提供账号登录，不会把导入文件上传到服务器。</p>
      <h2>本地偏好</h2>
      <p>页面只通过浏览器本地存储保存白天或深夜模式偏好。关闭或刷新页面后，导入的比赛数据不会持久保存。</p>
      <h2>正式版本边界</h2>
      <p>接入授权数据源前，需要补充正式隐私政策、删除入口、数据保留期限和用户授权流程。</p>
    </div>
  </main>;
}
