package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const (
	Version          = "0.1.0"
	HeartbeatInterval = 25 * time.Second
	ReconnectBase    = 2 * time.Second
	ReconnectMax     = 60 * time.Second
	SysInfoInterval  = 60 * time.Second
)

// ─── Protocol Messages ───────────────────────────────────

type Message struct {
	Type         string                 `json:"type"`
	Ts           int64                  `json:"ts"`
	MsgId        string                 `json:"msgId,omitempty"`
	Token        string                 `json:"token,omitempty"`
	Node         *NodeInfo              `json:"node,omitempty"`
	SessionId    string                 `json:"sessionId,omitempty"`
	Reason       string                 `json:"reason,omitempty"`
	Content      string                 `json:"content,omitempty"`
	ReplyTo      string                 `json:"replyTo,omitempty"`
	Cmd          string                 `json:"cmd,omitempty"`
	Args         []string               `json:"args,omitempty"`
	Timeout      int64                  `json:"timeout,omitempty"`
	ExitCode     int                    `json:"exitCode,omitempty"`
	Stdout       string                 `json:"stdout,omitempty"`
	Stderr       string                 `json:"stderr,omitempty"`
	DurationMs   int64                  `json:"durationMs,omitempty"`
	Name         string                 `json:"name,omitempty"`
	Data         map[string]interface{} `json:"data,omitempty"`
	Info         *SysInfo               `json:"info,omitempty"`
	FromNodeId   string                 `json:"fromNodeId,omitempty"`
	TargetNodeId string                 `json:"targetNodeId,omitempty"`
	Payload      map[string]interface{} `json:"payload,omitempty"`
	Nodes        []NodeSummary          `json:"nodes,omitempty"`
	Code         string                 `json:"code,omitempty"`
	Message      string                 `json:"message,omitempty"`
}

type NodeInfo struct {
	NodeId       string   `json:"nodeId"`
	Name         string   `json:"name"`
	Platform     string   `json:"platform"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
	Tags         []string `json:"tags,omitempty"`
}

type SysInfo struct {
	CpuPercent    float64 `json:"cpuPercent"`
	MemTotalMB    float64 `json:"memTotalMB"`
	MemUsedMB     float64 `json:"memUsedMB"`
	DiskTotalGB   float64 `json:"diskTotalGB"`
	DiskUsedGB    float64 `json:"diskUsedGB"`
	TempCelsius   float64 `json:"tempCelsius,omitempty"`
	UptimeSeconds int64   `json:"uptimeSeconds"`
	Hostname      string  `json:"hostname"`
	IpAddress     string  `json:"ipAddress"`
}

type NodeSummary struct {
	NodeId       string   `json:"nodeId"`
	Name         string   `json:"name"`
	Status       string   `json:"status"`
	Capabilities []string `json:"capabilities"`
}

// ─── Agent ───────────────────────────────────────────────

type Agent struct {
	gatewayURL string
	token      string
	nodeInfo   NodeInfo
	conn       *websocket.Conn
	mu         sync.Mutex
	done       chan struct{}
	sessionId  string
}

func NewAgent(gatewayURL, token string, nodeInfo NodeInfo) *Agent {
	return &Agent{
		gatewayURL: gatewayURL,
		token:      token,
		nodeInfo:   nodeInfo,
		done:       make(chan struct{}),
	}
}

func (a *Agent) Run() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go a.connectLoop()

	<-sigCh
	log.Println("[ForgeAI Node] Shutting down...")
	close(a.done)

	a.mu.Lock()
	if a.conn != nil {
		a.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
		a.conn.Close()
	}
	a.mu.Unlock()
}

func (a *Agent) connectLoop() {
	attempt := 0
	for {
		select {
		case <-a.done:
			return
		default:
		}

		if attempt > 0 {
			delay := ReconnectBase * time.Duration(1<<uint(min(attempt, 5)))
			jitter := time.Duration(rand.Int63n(int64(delay / 2)))
			wait := delay + jitter
			if wait > ReconnectMax {
				wait = ReconnectMax
			}
			log.Printf("[ForgeAI Node] Reconnecting in %s (attempt %d)...", wait, attempt)
			select {
			case <-time.After(wait):
			case <-a.done:
				return
			}
		}

		err := a.connect()
		if err != nil {
			log.Printf("[ForgeAI Node] Connection failed: %v", err)
			attempt++
			continue
		}

		attempt = 0
		a.readLoop()
	}
}

func (a *Agent) connect() error {
	u, err := url.Parse(a.gatewayURL)
	if err != nil {
		return fmt.Errorf("invalid gateway URL: %w", err)
	}

	// Convert http(s) to ws(s)
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = "/ws/node"

	log.Printf("[ForgeAI Node] Connecting to %s ...", u.String())

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return fmt.Errorf("websocket dial: %w", err)
	}

	a.mu.Lock()
	a.conn = conn
	a.mu.Unlock()

	// Send auth
	authMsg := Message{
		Type:  "auth",
		Ts:    nowMs(),
		Token: a.token,
		Node:  &a.nodeInfo,
	}
	if err := a.send(authMsg); err != nil {
		conn.Close()
		return fmt.Errorf("send auth: %w", err)
	}

	// Wait for auth response (5s timeout)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var resp Message
	if err := conn.ReadJSON(&resp); err != nil {
		conn.Close()
		return fmt.Errorf("read auth response: %w", err)
	}
	conn.SetReadDeadline(time.Time{}) // clear deadline

	if resp.Type == "auth_error" {
		conn.Close()
		return fmt.Errorf("auth rejected: %s", resp.Reason)
	}

	if resp.Type == "auth_ok" {
		a.sessionId = resp.SessionId
		log.Printf("[ForgeAI Node] ✓ Authenticated (session: %s)", resp.SessionId)
	}

	// Start heartbeat + sysinfo goroutines
	go a.heartbeatLoop()
	go a.sysInfoLoop()

	return nil
}

func (a *Agent) readLoop() {
	for {
		select {
		case <-a.done:
			return
		default:
		}

		var msg Message
		a.mu.Lock()
		conn := a.conn
		a.mu.Unlock()

		if conn == nil {
			return
		}

		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("[ForgeAI Node] Connection lost: %v", err)
			}
			return
		}

		switch msg.Type {
		case "pong":
			// heartbeat ack — no action needed
		case "command":
			go a.handleCommand(msg)
		case "response":
			log.Printf("[ForgeAI Node] AI Response: %s", truncate(msg.Content, 200))
		case "relay":
			log.Printf("[ForgeAI Node] Relay from %s: %v", msg.FromNodeId, msg.Payload)
		case "node_list":
			log.Printf("[ForgeAI Node] Connected nodes: %d", len(msg.Nodes))
			for _, n := range msg.Nodes {
				log.Printf("  → %s (%s) [%s]", n.Name, n.NodeId, n.Status)
			}
		case "error":
			log.Printf("[ForgeAI Node] Server error: [%s] %s", msg.Code, msg.Message)
		default:
			log.Printf("[ForgeAI Node] Unknown message type: %s", msg.Type)
		}
	}
}

// ─── Command Execution ───────────────────────────────────

func (a *Agent) handleCommand(msg Message) {
	log.Printf("[ForgeAI Node] Executing command: %s %s", msg.Cmd, strings.Join(msg.Args, " "))
	start := time.Now()

	timeout := 30 * time.Second
	if msg.Timeout > 0 {
		timeout = time.Duration(msg.Timeout) * time.Millisecond
	}

	// Build command
	var cmd *exec.Cmd
	if len(msg.Args) > 0 {
		cmd = exec.Command(msg.Cmd, msg.Args...)
	} else {
		// Shell execution
		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd", "/C", msg.Cmd)
		} else {
			cmd = exec.Command("sh", "-c", msg.Cmd)
		}
	}

	// Set timeout via context would be better but this is simpler for Go 1.21
	done := make(chan error, 1)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	go func() {
		done <- cmd.Run()
	}()

	var exitCode int
	select {
	case err := <-done:
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = -1
				stderr.WriteString(err.Error())
			}
		}
	case <-time.After(timeout):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		exitCode = -1
		stderr.WriteString("command timed out")
	}

	duration := time.Since(start).Milliseconds()

	result := Message{
		Type:       "command_result",
		Ts:         nowMs(),
		MsgId:      msg.MsgId,
		ExitCode:   exitCode,
		Stdout:     truncate(stdout.String(), 50000),
		Stderr:     truncate(stderr.String(), 10000),
		DurationMs: duration,
	}

	if err := a.send(result); err != nil {
		log.Printf("[ForgeAI Node] Failed to send command result: %v", err)
	}

	log.Printf("[ForgeAI Node] Command done (exit=%d, %dms)", exitCode, duration)
}

// ─── Heartbeat ───────────────────────────────────────────

func (a *Agent) heartbeatLoop() {
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-a.done:
			return
		case <-ticker.C:
			ping := Message{Type: "ping", Ts: nowMs()}
			if err := a.send(ping); err != nil {
				log.Printf("[ForgeAI Node] Heartbeat send failed: %v", err)
				return
			}
		}
	}
}

// ─── System Info ─────────────────────────────────────────

func (a *Agent) sysInfoLoop() {
	// Send initial sysinfo immediately
	a.sendSysInfo()

	ticker := time.NewTicker(SysInfoInterval)
	defer ticker.Stop()

	for {
		select {
		case <-a.done:
			return
		case <-ticker.C:
			a.sendSysInfo()
		}
	}
}

func (a *Agent) sendSysInfo() {
	info := collectSysInfo()
	msg := Message{
		Type: "sysinfo",
		Ts:   nowMs(),
		Info: &info,
	}
	if err := a.send(msg); err != nil {
		log.Printf("[ForgeAI Node] Failed to send sysinfo: %v", err)
	}
}

func collectSysInfo() SysInfo {
	hostname, _ := os.Hostname()

	info := SysInfo{
		Hostname:      hostname,
		UptimeSeconds: getUptime(),
		IpAddress:     getLocalIP(),
	}

	// Memory info (Linux)
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fmt.Sscanf(line, "MemTotal: %f kB", &info.MemTotalMB)
				info.MemTotalMB /= 1024
			}
			if strings.HasPrefix(line, "MemAvailable:") {
				var avail float64
				fmt.Sscanf(line, "MemAvailable: %f kB", &avail)
				info.MemUsedMB = info.MemTotalMB - (avail / 1024)
			}
		}
	}

	// CPU usage (simplified — 1s sample)
	if idle1, total1, err := readCPU(); err == nil {
		time.Sleep(500 * time.Millisecond)
		if idle2, total2, err := readCPU(); err == nil {
			idleDelta := float64(idle2 - idle1)
			totalDelta := float64(total2 - total1)
			if totalDelta > 0 {
				info.CpuPercent = (1.0 - idleDelta/totalDelta) * 100
			}
		}
	}

	// Temperature (Raspberry Pi / Linux thermal)
	if data, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp"); err == nil {
		var millideg float64
		fmt.Sscanf(strings.TrimSpace(string(data)), "%f", &millideg)
		info.TempCelsius = millideg / 1000
	}

	return info
}

func readCPU() (idle, total int64, err error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 {
		return 0, 0, fmt.Errorf("empty /proc/stat")
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 {
		return 0, 0, fmt.Errorf("unexpected /proc/stat format")
	}
	for i := 1; i < len(fields); i++ {
		var v int64
		fmt.Sscanf(fields[i], "%d", &v)
		total += v
		if i == 4 { // idle is 4th field
			idle = v
		}
	}
	return idle, total, nil
}

func getUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	var uptime float64
	fmt.Sscanf(string(data), "%f", &uptime)
	return int64(uptime)
}

func getLocalIP() string {
	// Simple approach: try to read from hostname command
	out, err := exec.Command("hostname", "-I").Output()
	if err == nil {
		parts := strings.Fields(string(out))
		if len(parts) > 0 {
			return parts[0]
		}
	}
	return "127.0.0.1"
}

// ─── Helpers ─────────────────────────────────────────────

func (a *Agent) send(msg Message) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn == nil {
		return fmt.Errorf("not connected")
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return a.conn.WriteMessage(websocket.TextMessage, data)
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func getPlatform() string {
	return fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
}

func detectCapabilities() []string {
	caps := []string{"shell", "system"}

	if runtime.GOOS == "linux" {
		// Check for GPIO (Raspberry Pi)
		if _, err := os.Stat("/sys/class/gpio"); err == nil {
			caps = append(caps, "gpio")
		}
		// Check for camera
		if _, err := exec.LookPath("raspistill"); err == nil {
			caps = append(caps, "camera")
		} else if _, err := exec.LookPath("libcamera-still"); err == nil {
			caps = append(caps, "camera")
		}
		// Check for docker
		if _, err := exec.LookPath("docker"); err == nil {
			caps = append(caps, "docker")
		}
		// Check for network tools
		if _, err := exec.LookPath("ip"); err == nil {
			caps = append(caps, "network")
		}
	}

	return caps
}

// ─── Main ────────────────────────────────────────────────

func main() {
	gateway := flag.String("gateway", "", "Gateway URL (e.g. http://localhost:18800)")
	token := flag.String("token", "", "API key for authentication")
	nodeId := flag.String("id", "", "Unique node ID (auto-generated if empty)")
	nodeName := flag.String("name", "", "Node display name")
	tagsStr := flag.String("tags", "", "Comma-separated tags (e.g. office,floor2)")
	flag.Parse()

	// Env var fallbacks
	if *gateway == "" {
		*gateway = os.Getenv("FORGEAI_GATEWAY")
	}
	if *token == "" {
		*token = os.Getenv("FORGEAI_NODE_TOKEN")
	}
	if *nodeId == "" {
		*nodeId = os.Getenv("FORGEAI_NODE_ID")
	}
	if *nodeName == "" {
		*nodeName = os.Getenv("FORGEAI_NODE_NAME")
	}

	if *gateway == "" || *token == "" {
		fmt.Println(`
╔═══════════════════════════════════════════╗
║         ForgeAI Node Agent v` + Version + `        ║
╚═══════════════════════════════════════════╝

Usage:
  forgeai-node --gateway <URL> --token <KEY> [options]

Options:
  --gateway   Gateway URL (or env FORGEAI_GATEWAY)
  --token     API key (or env FORGEAI_NODE_TOKEN)
  --id        Node ID (or env FORGEAI_NODE_ID, auto if empty)
  --name      Display name (or env FORGEAI_NODE_NAME)
  --tags      Comma-separated tags

Examples:
  forgeai-node --gateway http://192.168.1.100:18800 --token mykey123 --name "RaspberryPi-Office"
  FORGEAI_GATEWAY=http://gw:18800 FORGEAI_NODE_TOKEN=key forgeai-node
`)
		os.Exit(1)
	}

	// Auto-generate node ID if not set
	if *nodeId == "" {
		hostname, _ := os.Hostname()
		*nodeId = fmt.Sprintf("node-%s-%d", hostname, time.Now().UnixMilli()%10000)
	}
	if *nodeName == "" {
		hostname, _ := os.Hostname()
		*nodeName = hostname
	}

	var tags []string
	if *tagsStr != "" {
		tags = strings.Split(*tagsStr, ",")
	}

	nodeInfo := NodeInfo{
		NodeId:       *nodeId,
		Name:         *nodeName,
		Platform:     getPlatform(),
		Version:      Version,
		Capabilities: detectCapabilities(),
		Tags:         tags,
	}

	fmt.Printf(`
╔═══════════════════════════════════════════╗
║         ForgeAI Node Agent v%s        ║
╠═══════════════════════════════════════════╣
║  ID:       %-30s║
║  Name:     %-30s║
║  Platform: %-30s║
║  Caps:     %-30s║
║  Gateway:  %-30s║
╚═══════════════════════════════════════════╝
`, Version, nodeInfo.NodeId, nodeInfo.Name, nodeInfo.Platform,
		strings.Join(nodeInfo.Capabilities, ","), *gateway)

	agent := NewAgent(*gateway, *token, nodeInfo)
	agent.Run()
}
