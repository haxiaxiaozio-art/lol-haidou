import { HELPER_DOWNLOAD_URL, HELPER_LAUNCH_URL } from "../lib/local-client";
import styles from "./helper-install.module.css";

export default function HelperInstallGuide({ onLaunch, isBusy }: { onLaunch: () => void; isBusy: boolean }) {
  return (
    <section id="helper-install-guide" className={styles.guide} aria-labelledby="helper-install-title">
      <div className={styles.intro}>
        <div>
          <h2 id="helper-install-title">第一次使用？先装好数据助手</h2>
          <p>网页可以直接访问。读取新战绩，需要在同一台 Windows 电脑上运行助手并登录 LOL。</p>
        </div>
        <div className={styles.actions}>
          <a className={styles.download} href={HELPER_DOWNLOAD_URL}>下载 Windows 助手</a>
          <a href="https://github.com/haxiaxiaozio-art/lol-haidou/releases/latest" target="_blank" rel="noopener noreferrer">下载失败？打开发布页</a>
        </div>
      </div>
      <details className={styles.instructions}>
        <summary>安装步骤与常见问题</summary>
        <ol className={styles.steps}>
          <li><strong>下载安装包</strong><p>下载并运行 HaiDouHelperSetup.exe。普通玩家不用安装 Node.js，也不用下载源码。</p></li>
          <li><strong>选择安装位置</strong><p>在安装窗口选择自己可写的文件夹，可以放在 D 盘或其他盘，不必装在 C 盘。不要选择磁盘根目录、Windows 或 Program Files 文件夹。安装完成后助手会自动启动，并随当前 Windows 用户登录启动。</p></li>
          <li><strong>登录国服 LOL 客户端</strong><p>停留在客户端主页即可，不用进入对局。只打开 WeGame 还不够；网页不会要求填写 QQ 或游戏密码。</p></li>
          <li><strong>回到网页，连接助手</strong><p>浏览器询问是否允许访问本地网络时，为本站选择允许。如果助手没有运行，点击{isBusy ? <span aria-disabled="true" title="请等待当前检测或同步完成">已安装，启动助手</span> : <a href={HELPER_LAUNCH_URL} onClick={onLaunch}>已安装，启动助手</a>}，并确认浏览器的打开应用提示。等网页识别出玩家和大区后，再开始查询。</p></li>
          <li><strong>选择玩家和读取场次</strong><p>查自己选“我的战绩”；查同大区其他玩家选“检索玩家”，填写游戏名和尾标。可选择 20、40、100 或 200 场上限，实际返回数量取决于可用历史记录。</p></li>
        </ol>
        <div className={styles.faq}>
          <h3>遇到问题，先看这里</h3>
          <dl>
            <dt>别人打开网页，也要安装助手吗？</dt>
            <dd>读取新战绩时需要，每个人都要在自己的电脑上运行助手并登录 LOL。手机和 Mac 可以打开网页，但不能运行这个 Windows 安装包；已保存的战报可在“我的战报库”查看或恢复，无需助手。</dd>
            <dt>装过了，还是提示未找到助手？</dt>
            <dd>确认网页、助手和 LOL 在同一台电脑上，点击“已安装，启动助手”。如果之前拒绝了本地网络权限，请在浏览器的本站权限设置中重新允许，再刷新网页。仍未连接时，查看下方“同步失败诊断中心”的具体原因。</dd>
            <dt>提示助手版本过旧？</dt>
            <dd>重新下载并运行安装包，选择原来的安装位置。安装器会关闭旧助手、完成更新并重新启动，无需手动删除文件。</dd>
            <dt>Windows 提示“未知发布者”怎么办？</dt>
            <dd>当前安装包尚未使用受信任的代码签名。请先核对文件名与本页链接指向的 GitHub 发布仓库，再决定是否安装。若安全软件明确报毒或公司策略拦截，请停止安装并保留提示，不要关闭安全防护。</dd>
            <dt>不需要了，怎么卸载？</dt>
            <dd>在 Windows 设置的“已安装的应用”中找到 HaiDou Data Helper 并卸载，不要直接删除安装文件夹。</dd>
          </dl>
        </div>
      </details>
    </section>
  );
}
