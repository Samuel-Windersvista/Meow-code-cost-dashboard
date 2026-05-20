import { useMemo, useState } from "react"

export type DashboardLanguage = "en" | "zh"

type Dictionary = {
  eyebrow: string
  title: string
  subtitle: string
  series: string
  seriesQueryControls: string
  refresh: string
  refreshing: string
  switchLanguage: string
  secondsShort: string
  minutesShort: string
  hoursShort: string
  daysShort: string
  authSession: string
  backendDiagnostics: string
  backendOnline: string
  backendOffline: string
  analysisPanels: string
  loading: string
  attentionRequired: string
  windowSpend: string
  lifetimeSpend: string
  activeAlerts: string
  priceCoverage: string
  syncLag: string
  totalTokens: string
  chartTitle: string
  chartSubtitle: string
  noSeries: string
  cost: string
  tokens: string
  live: string
  authenticated: string
  unauthenticated: string
  healthy: string
  delayed: string
  unknown: string
  lag: string
  never: string
  windowLabel: string
  selectedWindow: string
  customWindow: string
  startDate: string
  endDate: string
  invalidCustomWindow: string
  compare: string
  filters: string
  model: string
  provider: string
  source: string
  cache: string
  search: string
  granularityLabel: string
  metricLabel: string
  oneHour: string
  twentyFourHours: string
  sevenDaysShort: string
  thirtyDaysShort: string
  ninetyDaysShort: string
  allTime: string
  hourly: string
  daily: string
  weekly: string
  monthly: string
  input: string
  output: string
  reasoning: string
  cacheRead: string
  thirtyDayWindow: string
  synced: string
  lastSync: string
  trendStrip: string
  insightRail: string
  latestBucket: string
  peakValue: string
  selectedMetric: string
  percentOfLifetime: string
  investigateSignals: string
  noWarnings: string
  anomalyAlerts: string
  topModelShare: string
  pricingIssues: string
  expensiveSessions: string
  tokenSessions: string
  pricingDrilldown: string
  activityHeatmap: string
  freshness: string
  activePricing: string
  cacheEfficiency: string
  effectiveCost: string
  pricingSources: string
  edit: string
  missingPricing: string
  archive: string
  manual: string
  save: string
  cacheWrite: string
  confidence: string
  observed: string
  effective: string
  enabled: string
  superseded: string
  reasoningRule: string
  yes: string
  no: string
  expand: string
  collapse: string
  // Generic labels
  unavailable: string
  firstSeen: string
  lastSeen: string
  reason: string
  hint: string
  tokensUnit: string
  sessionsUnit: string
  recordsUnit: string
  messagesUnit: string
  modelsUnit: string
  current: string
  action: string
  ok: string
  noSessions: string
  noGaps: string
  noSessionsAvailable: string
  pricingRecordsUnavailable: string
  freshnessUnavailable: string
  noMissingPricing: string
  noObservedCoverage: string
  pricedVia: string
  unpriced: string
  gap: string
  estimated: string
  emptyState: string
  // Backend management
  connectDashboard: string
  dashboardToken: string
  tokenFilePath: string
  lastSuccessfulSync: string
  lastUpdateAttempt: string
  startBackend: string
  restartBackend: string
  retryStatus: string
  backendOfflineUpdateDisabled: string
  unauthenticatedUpdateDisabled: string
  connectingDashboard: string
  tokenAuthFailed: string
  tokenFileHelp: string
  localOnlyDescription: string
  startingBackend: string
  restartingBackend: string
  checkingBackend: string
  backendControlFailed: string
  backendControlCompleted: string
  backendControlHelp: string
  // Chart strings
  range: string
  buckets: string
  unit: string
  xAxis: string
  yAxis: string
  seriesDetails: string
  of: string
  showing: string
  noActiveSpikes: string
  noSpikeAlerts: string
  modelShareUnavailable: string
  noOpenIssues: string
  noPricingIssues: string
  noActivity: string
  zeroSelectedMetric: string
  usdUnit: string
  spikeSingular: string
  spikePlural: string
  issueSingular: string
  issuePlural: string
  modelSingular: string
  windowEmpty: string
  effectiveCostFormula: string
  basedOnPricedTokens: string
  pricingCoverageLabel: string
  observedProviderCoverage: string
  // Enum display values
  enumManual: string
  enumOfficial: string
  enumOpenRouter: string
  enumWebSearch: string
  enumPerToken: string
  enumIncludedInOutput: string
  enumStale: string
  enumActive: string
  enumDisabled: string
  enumPriced: string
  enumMissing: string
  // Multi-source
  sourceLabel: string
  sourceOpencode: string
  sourceHermes: string
  allSources: string
  selectSource: string
}

const DICTIONARY: Record<DashboardLanguage, Dictionary> = {
  en: {
    eyebrow: "Spend Command Center",
    title: "OpenCode Cost Observatory",
    subtitle: "Dense local telemetry for spend, token flow, and refresh health across your analytics store.",
    series: "Series",
    seriesQueryControls: "Series Explorer query controls",
    refresh: "Update",
    refreshing: "Updating…",
    switchLanguage: "Toggle Language",
    secondsShort: "s",
    minutesShort: "m",
    hoursShort: "h",
    daysShort: "d",
    authSession: "Auth Session",
    backendDiagnostics: "Backend Status & Diagnostics",
    backendOnline: "Backend Online",
    backendOffline: "Backend Offline",
    analysisPanels: "Leaderboards & Pricing",
    loading: "Loading",
    attentionRequired: "Attention Required",
    windowSpend: "Window Spend",
    lifetimeSpend: "Lifetime Spend",
    activeAlerts: "Active Alerts",
    priceCoverage: "Price Coverage",
    syncLag: "Sync Lag",
    totalTokens: "Lifetime Tokens",
    chartTitle: "Series Explorer",
    chartSubtitle: "Metric pivots, shell controls, and the insight rail are ready for deeper drilldowns.",
    noSeries: "No series points yet",
    cost: "Cost",
    tokens: "Tokens",
    live: "Live",
    authenticated: "Authenticated",
    unauthenticated: "Unauthenticated",
    healthy: "Healthy",
    delayed: "Delayed",
    unknown: "Unknown",
    lag: "lag",
    never: "Never synced",
    windowLabel: "Window",
    selectedWindow: "Selected Window",
    customWindow: "Custom Window",
    startDate: "Start date",
    endDate: "End date",
    invalidCustomWindow: "End date must be on or after start date",
    compare: "Compare",
    filters: "Filters",
    model: "Model",
    provider: "Provider",
    source: "Source",
    cache: "Cache",
    search: "Search",
    granularityLabel: "Granularity",
    metricLabel: "Metric",
    oneHour: "1H",
    twentyFourHours: "24H",
    sevenDaysShort: "7D",
    thirtyDaysShort: "30D",
    ninetyDaysShort: "90D",
    allTime: "ALL",
    hourly: "Hourly",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    input: "Input",
    output: "Output",
    reasoning: "Reasoning",
    cacheRead: "Cache Read",
    thirtyDayWindow: "30D cost window",
    synced: "Sync telemetry",
    lastSync: "Last Sync",
    trendStrip: "Trend Strip",
    insightRail: "Insight Rail",
    latestBucket: "Latest Bucket",
    peakValue: "Peak Value",
    selectedMetric: "Selected Metric",
    percentOfLifetime: "% of lifetime",
    investigateSignals: "Investigate degraded signals",
    noWarnings: "No active warnings",
    anomalyAlerts: "Spike Alerts",
    topModelShare: "Window Overview",
    pricingIssues: "Pricing Issues",
    expensiveSessions: "Most Expensive Sessions",
    tokenSessions: "Highest Token Sessions",
    pricingDrilldown: "Pricing Drilldown",
    activityHeatmap: "Activity Heatmap",
    freshness: "Freshness",
    activePricing: "Active Pricing",
    cacheEfficiency: "Cache Efficiency",
    effectiveCost: "Avg Cost / 1M Tokens",
    pricingSources: "Pricing Sources",
    edit: "Edit",
    missingPricing: "Missing Pricing",
    archive: "Archive",
    manual: "Manual",
    save: "Save",
    cacheWrite: "Cache Write",
    confidence: "Confidence",
    observed: "Observed",
    effective: "Effective",
    enabled: "Enabled",
    superseded: "Superseded",
    reasoningRule: "Reasoning Rule",
    yes: "Yes",
    no: "No",
    expand: "Expand",
    collapse: "Collapse",
    // Generic labels
    unavailable: "Unavailable",
    firstSeen: "First seen",
    lastSeen: "Last seen",
    reason: "Reason",
    hint: "Hint",
    tokensUnit: "tokens",
    sessionsUnit: "sessions",
    recordsUnit: "records",
    messagesUnit: "messages",
    modelsUnit: "models",
    current: "Current",
    action: "Action",
    ok: "OK",
    noSessions: "No sessions",
    noGaps: "No gaps",
    noSessionsAvailable: "No sessions available",
    pricingRecordsUnavailable: "Pricing records unavailable",
    freshnessUnavailable: "Freshness unavailable",
    noMissingPricing: "No missing pricing detected",
    noObservedCoverage: "No observed provider coverage",
    pricedVia: "priced via",
    unpriced: "unpriced",
    gap: "gap",
    estimated: "estimated",
    emptyState: "No usage data for the selected source and window.",
    // Backend management
    connectDashboard: "Connect local dashboard",
    dashboardToken: "Dashboard token",
    tokenFilePath: "Token file path",
    lastSuccessfulSync: "Last successful sync",
    lastUpdateAttempt: "Last update attempt",
    startBackend: "Start Backend",
    restartBackend: "Restart Backend",
    retryStatus: "Retry Status",
    backendOfflineUpdateDisabled: "Backend is offline; start the local dashboard service before updating.",
    unauthenticatedUpdateDisabled: "Sign in with the local dashboard token before updating.",
    connectingDashboard: "Connecting local dashboard...",
    tokenAuthFailed: "Local token authentication failed.",
    tokenFileHelp: "Uses the localhost token file to authenticate this browser.",
    localOnlyDescription: "Local browser only: submit a local token or the default .run/dashboard.token file through the localhost-only endpoint.",
    startingBackend: "Starting backend...",
    restartingBackend: "Restarting backend...",
    checkingBackend: "Checking backend status...",
    backendControlFailed: "Backend control action failed.",
    backendControlCompleted: "Backend control command completed; use the local token form if not connected.",
    backendControlHelp: "Use the Vite-local control endpoint to start or restart the backend.",
    // Chart strings
    range: "Range",
    buckets: "buckets",
    unit: "Unit",
    xAxis: "X-axis: Time",
    yAxis: "Y-axis",
    seriesDetails: "Series Explorer Details",
    of: "of",
    showing: "Showing",
    noActiveSpikes: "No active spikes",
    noSpikeAlerts: "No spike alerts detected for the selected window.",
    modelShareUnavailable: "Model-share breakdown is unavailable for this data window.",
    noOpenIssues: "No open issues",
    noPricingIssues: "No lifetime pricing issues are currently visible.",
    noActivity: "No activity",
    zeroSelectedMetric: "0 selected metric",
    usdUnit: "USD",
    spikeSingular: "spike",
    spikePlural: "spikes",
    issueSingular: "issue",
    issuePlural: "issues",
    modelSingular: "model",
    windowEmpty: "Empty window",
    effectiveCostFormula: "Formula: lifetime spend / lifetime tokens x 1,000,000",
    basedOnPricedTokens: "Based on priced tokens",
    pricingCoverageLabel: "pricing coverage",
    observedProviderCoverage: "Observed Provider Coverage",
    // Enum display values
    enumManual: "Manual",
    enumOfficial: "Official",
    enumOpenRouter: "OpenRouter",
    enumWebSearch: "Web Search",
    enumPerToken: "Per Token",
    enumIncludedInOutput: "Included in Output",
    enumStale: "Stale",
    enumActive: "Active",
    enumDisabled: "Disabled",
    enumPriced: "Priced",
    enumMissing: "Missing",
    // Multi-source
    sourceLabel: "Data Source",
    sourceOpencode: "OpenCode",
    sourceHermes: "Hermes",
    allSources: "All Sources",
    selectSource: "Select source",
  },
  zh: {
    eyebrow: "成本指挥台",
    title: "OpenCode 成本观测台",
    subtitle: "面向本地分析库的高密度成本、令牌流量与刷新健康度控制台。",
    series: "趋势图",
    seriesQueryControls: "序列浏览器查询控件",
    refresh: "更新",
    refreshing: "正在更新…",
    switchLanguage: "切换语言",
    secondsShort: "秒",
    minutesShort: "分",
    hoursShort: "时",
    daysShort: "天",
    authSession: "认证会话",
    backendDiagnostics: "后端状态与诊断",
    backendOnline: "后端在线",
    backendOffline: "后端离线",
    analysisPanels: "排行榜与定价",
    loading: "加载中",
    attentionRequired: "需要关注",
    windowSpend: "窗口成本",
    lifetimeSpend: "累计花费",
    activeAlerts: "告警",
    priceCoverage: "定价覆盖",
    syncLag: "同步延迟",
    totalTokens: "累计令牌",
    chartTitle: "序列浏览器",
    chartSubtitle: "指标切换、壳层控制与洞察侧栏已经就位，可继续扩展下钻能力。",
    noSeries: "暂时没有序列数据",
    cost: "成本",
    tokens: "令牌",
    live: "在线",
    authenticated: "已认证",
    unauthenticated: "未认证",
    healthy: "健康",
    delayed: "延迟",
    unknown: "未知",
    lag: "延迟",
    never: "尚未同步",
    windowLabel: "时间窗口",
    selectedWindow: "当前窗口",
    customWindow: "自定义窗口",
    startDate: "开始日期",
    endDate: "结束日期",
    invalidCustomWindow: "结束日期不能早于开始日期",
    compare: "对比",
    filters: "筛选",
    model: "模型",
    provider: "供应商",
    source: "来源",
    cache: "缓存",
    search: "搜索",
    granularityLabel: "粒度",
    metricLabel: "指标",
    oneHour: "1小时",
    twentyFourHours: "24小时",
    sevenDaysShort: "7天",
    thirtyDaysShort: "30天",
    ninetyDaysShort: "90天",
    allTime: "全部",
    hourly: "每小时",
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
    input: "输入",
    output: "输出",
    reasoning: "推理",
    cacheRead: "缓存读取",
    thirtyDayWindow: "30 天成本窗口",
    synced: "同步遥测",
    lastSync: "最后同步",
    trendStrip: "趋势条",
    insightRail: "洞察侧栏",
    latestBucket: "最新桶",
    peakValue: "峰值",
    selectedMetric: "当前指标",
    percentOfLifetime: "占累计比例",
    investigateSignals: "需要排查降级信号",
    noWarnings: "当前无告警",
    anomalyAlerts: "尖峰告警",
    topModelShare: "窗口概览",
    pricingIssues: "定价问题",
    expensiveSessions: "最贵会话",
    tokenSessions: "最高令牌会话",
    pricingDrilldown: "定价下钻",
    activityHeatmap: "活动热力图",
    freshness: "新鲜度",
    activePricing: "有效定价",
    cacheEfficiency: "缓存效率",
    effectiveCost: "每百万令牌均价",
    pricingSources: "定价来源",
    edit: "编辑",
    missingPricing: "缺失定价",
    archive: "归档",
    manual: "手动",
    save: "保存",
    cacheWrite: "缓存写入",
    confidence: "置信度",
    observed: "观测时间",
    effective: "生效时间",
    enabled: "启用",
    superseded: "已替代",
    reasoningRule: "推理规则",
    yes: "是",
    no: "否",
    expand: "展开",
    collapse: "收起",
    // Generic labels
    unavailable: "不可用",
    firstSeen: "首次出现",
    lastSeen: "最后出现",
    reason: "原因",
    hint: "提示",
    tokensUnit: "令牌",
    sessionsUnit: "会话",
    recordsUnit: "记录",
    messagesUnit: "消息",
    modelsUnit: "模型",
    current: "当前",
    action: "操作",
    ok: "确定",
    noSessions: "无会话",
    noGaps: "无缺口",
    noSessionsAvailable: "无可用会话",
    pricingRecordsUnavailable: "定价记录不可用",
    freshnessUnavailable: "新鲜度不可用",
    noMissingPricing: "未检测到缺失定价",
    noObservedCoverage: "未检测到供应商覆盖",
    pricedVia: "定价自",
    unpriced: "未定价",
    gap: "缺口",
    estimated: "估算",
    emptyState: "所选数据源和时间窗口无用量数据。",
    // Backend management
    connectDashboard: "连接本地仪表盘",
    dashboardToken: "仪表盘令牌",
    tokenFilePath: "令牌文件路径",
    lastSuccessfulSync: "上次成功同步",
    lastUpdateAttempt: "上次更新尝试",
    startBackend: "启动后端",
    restartBackend: "重启后端",
    retryStatus: "重试状态",
    backendOfflineUpdateDisabled: "后端离线；请先启动本地仪表盘服务再更新。",
    unauthenticatedUpdateDisabled: "请先使用本地仪表盘令牌登录再更新。",
    connectingDashboard: "正在连接本地仪表盘...",
    tokenAuthFailed: "本地令牌认证失败。",
    tokenFileHelp: "使用本地令牌文件认证此浏览器。",
    localOnlyDescription: "仅限本地浏览器：通过 localhost 端点提交本地令牌或默认的 .run/dashboard.token 文件。",
    startingBackend: "正在启动后端...",
    restartingBackend: "正在重启后端...",
    checkingBackend: "正在检查后端状态...",
    backendControlFailed: "后端控制操作失败。",
    backendControlCompleted: "后端控制命令已完成；如未连接请使用本地令牌表单。",
    backendControlHelp: "使用 Vite 本地控制端点启动或重启后端。",
    // Chart strings
    range: "范围",
    buckets: "个桶",
    unit: "单位",
    xAxis: "X轴：时间",
    yAxis: "Y轴",
    seriesDetails: "序列浏览器详情",
    of: "共",
    showing: "显示",
    noActiveSpikes: "无活跃尖峰",
    noSpikeAlerts: "所选窗口未检测到尖峰告警。",
    modelShareUnavailable: "此数据窗口的模型占比不可用。",
    noOpenIssues: "无待处理问题",
    noPricingIssues: "当前无可视的累计定价问题。",
    noActivity: "无活动",
    zeroSelectedMetric: "0 个选中指标",
    usdUnit: "美元",
    spikeSingular: "个尖峰",
    spikePlural: "个尖峰",
    issueSingular: "个问题",
    issuePlural: "个问题",
    modelSingular: "个模型",
    windowEmpty: "空窗口",
    effectiveCostFormula: "公式：累计花费 / 累计令牌 x 1,000,000",
    basedOnPricedTokens: "基于已定价令牌",
    pricingCoverageLabel: "定价覆盖",
    observedProviderCoverage: "已观测供应商覆盖",
    // Enum display values
    enumManual: "手动",
    enumOfficial: "官方",
    enumOpenRouter: "OpenRouter",
    enumWebSearch: "网络搜索",
    enumPerToken: "按令牌",
    enumIncludedInOutput: "含于输出",
    enumStale: "过期",
    enumActive: "活跃",
    enumDisabled: "已禁用",
    enumPriced: "已定价",
    enumMissing: "缺失",
    // Multi-source
    sourceLabel: "数据源",
    sourceOpencode: "OpenCode",
    sourceHermes: "Hermes",
    allSources: "全部数据源",
    selectSource: "选择数据源",
  },
}

export function useI18n(initialLanguage: DashboardLanguage = "zh") {
  const [language, setLanguage] = useState<DashboardLanguage>(initialLanguage)

  const copy = useMemo(() => DICTIONARY[language], [language])

  return {
    language,
    locale: language === "zh" ? "zh-CN" : "en-US",
    copy,
    toggleLanguage() {
      setLanguage((current) => current === "en" ? "zh" : "en")
    },
  }
}
