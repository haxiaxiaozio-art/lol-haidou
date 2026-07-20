import Link from "next/link";
import styles from "./legal.module.css";

export default function NotFound() {
  return <main className={styles.shell}>
    <Link className={styles.back} href="/">← 返回海斗战报</Link>
    <h1>这局没有记录</h1>
    <p>你访问的页面不存在，回到主页继续查看演示数据或导入自己的对局。</p>
  </main>;
}
