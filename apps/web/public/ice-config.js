// 运行时 ICE 配置占位文件。
// 生产环境由 web 容器的 entrypoint（docker/40-peerlink-ice-config.sh）按容器
// 环境变量重新生成；dev / 未注入时为空，前端回退到构建期默认值与 DEFAULT_STUN。
window.__PEERLINK_ICE__ = {};
