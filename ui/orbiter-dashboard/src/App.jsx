import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid 
} from 'recharts';
import { 
  Bot, Wifi, Database, Sun, Calendar, Truck, Camera, 
  Activity, Brain, CheckCircle2, AlertTriangle, List, 
  ShieldCheck, ShieldAlert, Maximize2, X, Rocket, Send,
  History, Eye 
} from 'lucide-react';

export default function App() {
  const [hazardHistory, setHazardHistory] = useState([]); 
  const [currentScore, setCurrentScore] = useState(0); 
  const [currentScience, setCurrentScience] = useState(0); 
  const [logs, setLogs] = useState([
    { time: new Date().toLocaleTimeString(), msg: "System Initialized. Ready for commands...", type: "info" }
  ]);
  const [diagnostics, setDiagnostics] = useState([
      { icon: Bot, color: "text-sciFiTeal", text: "Waiting for telemetry..." }
  ]);
  const [systemStatus, setSystemStatus] = useState("SAFE"); 
  const [pastMissions, setPastMissions] = useState([]); 
  
  const [lastAnalysis, setLastAnalysis] = useState(""); 
  const [safetyTrend, setSafetyTrend] = useState(0);

  // --- MISSION CONTROL STATE ---
  const [missionDate, setMissionDate] = useState("2024-01-01"); 
  const [selectedRover, setSelectedRover] = useState("perseverance"); 
  const [isLaunching, setIsLaunching] = useState(false);

  const [metadata, setMetadata] = useState({
      sol: "--",
      date: "--",
      rover: "--",
      camera: "--",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/NASA_Mars_Rover.jpg/1200px-NASA_Mars_Rover.jpg" 
  });
  
  const [isFullScreen, setIsFullScreen] = useState(false);

  // --- HELPER: Parse Text to UI Components ---
  const generateDiagnostics = (rawText) => {
    const lines = Array.isArray(rawText) ? rawText : rawText.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];
  
    return lines.map(line => {
        const text = line.trim();
        const isRisk = text.includes("Risk") || text.includes("⚠️");
        const isSci = text.includes("Scientific") || text.includes("🧠");
        const isTerrain = text.includes("Terrain") || text.includes("🟡");
        
        return { 
            text, 
            isHeader: isRisk || isSci || isTerrain,
            color: isRisk ? "text-yellow-400" : isSci ? "text-purple-400" : isTerrain ? "text-sciFiTeal" : "text-gray-300",
            bg: isRisk ? "bg-yellow-900/20" : isSci ? "bg-purple-900/20" : isTerrain ? "bg-teal-900/20" : "bg-transparent",
            border: isRisk || isSci || isTerrain ? "border-l-2" : "border-0",
            icon: isRisk ? AlertTriangle : isSci ? Brain : isTerrain ? Activity : CheckCircle2
        };
    });
  };

  // --- REMOVED LOCAL STORAGE EFFECTS HERE ---

  const handleHistoryClick = (data) => {
      console.log("Viewing History Item:", data);
      
      setMetadata({
          sol: data.fullData.sol || "--",
          date: data.fullData.earth_date || "--",
          rover: data.fullData.rover_id || selectedRover,
          camera: data.fullData.camera || "NAVCAM",
          imageUrl: data.fullData.img_src || data.fullData.image_url 
      });
      setCurrentScore(data.score);
      setCurrentScience(data.science);
      const analysisText = data.fullData.gemini_reasoning || data.fullData.analysis_text || "";
      setLastAnalysis(analysisText);
      setDiagnostics(generateDiagnostics(analysisText));
      
      if (data.score > 7) setSystemStatus("CRITICAL");
      else if (data.score > 4) setSystemStatus("REVIEW"); 
      else setSystemStatus("SAFE");
  };

  const triggerMission = async () => {
    if (!missionDate) return;
    setIsLaunching(true);
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `📡 Connecting to ${selectedRover.toUpperCase()} (Date: ${missionDate})...`, type: "info" }, ...prev]);
    
    try {
        const res = await fetch("http://127.0.0.1:8000/trigger_mission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                earth_date: missionDate,
                rover_name: selectedRover 
            })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || "Mission Failed");
        }
        
        const data = await res.json();
        setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `✅ Link Established. Downloading ${data.count} images...`, type: "success" }, ...prev]);
    } catch (err) {
        setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `❌ Uplink Error: ${err.message}`, type: "danger" }, ...prev]);
    } finally {
        setIsLaunching(false);
    }
  };

  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8000/ws");

    ws.onmessage = (event) => {
      const packet = JSON.parse(event.data);
      
      if (packet.type === "LOG") {
          setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: packet.data.msg, type: packet.data.type }, ...prev]);
      }
      else if (packet.type === "UPLINK") {
          const d = packet.data;
          setMetadata({
              sol: d.sol,
              date: d.earth_date,
              rover: d.rover,
              camera: d.camera,
              imageUrl: `${d.image_url}?t=${new Date().getTime()}`
          });
      }
      else if (packet.type === "TELEMETRY") {
        const d = packet.data;
        
        // We use the current live image URL for the history entry
        // NOTE: If you click history (changing metadata.imageUrl), this hook restarts 
        // due to the dependency below. This is standard React behavior.
        const historyItem = { 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 
            score: d.hazard_score,
            science: d.scientific_value || 0,
            action: d.terrain_type,
            sol: d.sol,
            fullData: { ...d, img_src: d.img_src ||d.imageUrl|| metadata.imageUrl } 
        };

        setHazardHistory(prev => {
            const newHistory = [...prev, historyItem];
            return newHistory.slice(-20); 
        });
        setPastMissions(prev => [historyItem, ...prev]);

        setSystemStatus("SAFE");
        setCurrentScore(d.hazard_score);
        setCurrentScience(d.scientific_value || 0); 
        const rawText = d.gemini_reasoning || d.analysis_text || "";
        setLastAnalysis(rawText); 
        setDiagnostics(generateDiagnostics(rawText)); 
      } 
      else if (packet.type === "ALERT") {
          const actionText = (packet.data.action || "").toUpperCase();
          if (actionText.includes("HUMAN") || actionText.includes("REVIEW")) {
              setSystemStatus("REVIEW");
              setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `⚠️ REVIEW REQ: ${packet.data.action}`, type: "warning" }, ...prev]);
          } else {
              setSystemStatus("CRITICAL");
              setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `🚨 STOP: ${packet.data.action}`, type: "danger" }, ...prev]);
          }
      }
      else if (packet.type === "TREND") {
         if (packet.data.avg_hazard !== undefined) {
             setSafetyTrend(Number(packet.data.avg_hazard).toFixed(1));
         }
      }
    };
    return () => ws.close();
  }, [metadata.imageUrl]); // Dependency required to capture correct image URL in history

  const renderStatusBox = () => {
      if (systemStatus === 'CRITICAL') {
          return (
            <> 
              <ShieldAlert className="w-8 h-8 text-dangerRed mb-1 animate-pulse" /> 
              <div className="text-2xl font-black text-dangerRed glow-red">CRITICAL</div> 
              <div className="text-[10px] font-bold text-white tracking-wider border border-red-500/50 px-2 py-1 rounded bg-black/40">STOP ROVER</div> 
            </>
          );
      } else if (systemStatus === 'REVIEW') {
          return (
            <> 
              <Eye className="w-8 h-8 text-yellow-400 mb-1 animate-bounce" /> 
              <div className="text-2xl font-black text-yellow-400" style={{ textShadow: "0 0 10px rgba(250, 204, 21, 0.5)" }}>WARNING</div> 
              <div className="text-[10px] font-bold text-white tracking-wider border border-yellow-500/50 px-2 py-1 rounded bg-black/40">HUMAN REVIEW REQ</div> 
            </>
          );
      } else {
          return (
            <> 
              <ShieldCheck className="w-8 h-8 text-safeGreen mb-1 animate-pulse" /> 
              <div className="text-2xl font-black text-safeGreen glow-green">SAFE</div> 
              <div className="text-[10px] font-bold text-white tracking-wider border border-green-500/50 px-2 py-1 rounded bg-black/40">PROCEED</div> 
            </>
          );
      }
  };

  const getStatusPanelStyles = () => {
      if (systemStatus === 'CRITICAL') return 'bg-red-900/10 border-l border-red-500/50';
      if (systemStatus === 'REVIEW') return 'bg-yellow-900/10 border-l border-yellow-500/50';
      return 'bg-green-900/10 border-l border-green-500/50';
  };

  const getStatusHeaderStyles = () => {
      if (systemStatus === 'CRITICAL') return 'border-red-500/30 bg-red-900/20 text-red-400';
      if (systemStatus === 'REVIEW') return 'border-yellow-500/30 bg-yellow-900/20 text-yellow-400';
      return 'border-green-500/30 bg-green-900/20 text-green-400';
  };

  return (
    <div className="min-h-screen font-mono flex flex-col p-4 gap-4 text-[#e0e0e0] bg-black">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center panel p-3 shrink-0 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Bot className="w-8 h-8 text-sciFiTeal" />
          <h1 className="text-2xl font-bold tracking-[0.2em] glow-text hidden md:block">
            ORBITER MISSION CONTROL
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-black/40 p-1.5 rounded border border-teal-900/50 w-full md:w-auto justify-center">
            <div className="relative">
                <Truck className="absolute left-2 top-1.5 w-3 h-3 text-sciFiTeal pointer-events-none" />
                <select 
                    value={selectedRover}
                    onChange={(e) => setSelectedRover(e.target.value)}
                    className="bg-black text-sciFiTeal text-xs border border-teal-800 rounded pl-7 pr-2 py-1 outline-none focus:border-sciFiTeal appearance-none cursor-pointer hover:bg-teal-900/20 uppercase font-bold"
                >
                    <option value="perseverance">Perseverance</option>
                    <option value="curiosity">Curiosity</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="spirit">Spirit</option>
                </select>
            </div>
            <div className="relative">
                <Calendar className="absolute left-2 top-1.5 w-3 h-3 text-sciFiTeal pointer-events-none" />
                <input 
                    type="date" 
                    value={missionDate}
                    onChange={(e) => setMissionDate(e.target.value)}
                    className="bg-black text-sciFiTeal text-xs border border-teal-800 rounded pl-7 pr-2 py-1 outline-none focus:border-sciFiTeal cursor-pointer"
                />
            </div>
            <button 
                onClick={triggerMission}
                disabled={isLaunching}
                className={`flex items-center gap-2 px-4 py-1 rounded text-xs font-bold transition-all ${
                    isLaunching 
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
                    : 'bg-sciFiTeal text-black hover:bg-white hover:shadow-[0_0_15px_rgba(0,255,242,0.5)]'
                }`}
            >
                {isLaunching ? <Rocket className="w-3 h-3 animate-bounce" /> : <Send className="w-3 h-3" />}
                {isLaunching ? "TRANSMITTING..." : "UPLINK"}
            </button>
        </div>
        <div className="flex items-center gap-4 text-sm hidden md:flex">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">LINK:</span>
            <span className="font-bold flex items-center gap-1 text-green-400">
              ACTIVE <Wifi className="w-4 h-4" />
            </span>
          </div>
        </div>
      </header>

      {/* MAIN GRID */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* LEFT COLUMN */}
        <div className="col-span-1 md:col-span-3 flex flex-col gap-4">
          <div className="panel flex flex-col">
            <div className="p-3 border-b border-teal-900/50">
              <h2 className="font-bold text-sciFiTeal flex items-center gap-2">
                <Database className="w-4 h-4" /> METADATA
              </h2>
            </div>
            <div className="p-4 flex flex-col gap-3 text-sm">
              <MetaRow icon={Sun} label="Mars Sol" value={metadata.sol} highlight />
              <MetaRow icon={Calendar} label="Earth Date" value={metadata.date} />
              <MetaRow icon={Truck} label="Rover" value={metadata.rover} color="text-sciFiTeal" />
              <div className="flex justify-between border-b border-gray-800 pb-2">
                 <span className="text-gray-500 flex items-center gap-2">
                    <Activity className="w-3 h-3 text-purple-400" /> Safety Index (1m):
                 </span>
                 <span className={`font-bold text-xl ${
                     parseFloat(safetyTrend) > 5 ? 'text-red-400' : 'text-green-400'
                 }`}>
                     {safetyTrend}
                 </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 flex items-center gap-2"><Camera className="w-3 h-3" /> Cam:</span>
                <span className="text-xs bg-teal-900 px-2 py-1 rounded text-white">{metadata.camera}</span>
              </div>
            </div>
          </div>

          <div className="panel flex flex-col h-[500px]">
             <div className="p-3 border-b border-teal-900/50 flex justify-between items-center">
                 <h2 className="font-bold text-sciFiTeal flex items-center gap-2"><Activity className="w-4 h-4" /> LIVE TELEMETRY</h2>
                 <div className="flex gap-3 text-[10px]">
                     <span className="text-sciFiTeal flex items-center gap-1"><div className="w-2 h-2 bg-sciFiTeal rounded-full"></div> HAZARD</span>
                     <span className="text-purple-400 flex items-center gap-1"><div className="w-2 h-2 bg-purple-400 rounded-full"></div> SCIENCE</span>
                 </div>
             </div>
             <div className="p-4 flex-1 relative w-full h-full pb-8 pr-4">
              <div className="absolute inset-0 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={hazardHistory} 
                    onClick={(e) => {
                        if (e && e.activePayload) handleHistoryClick(e.activePayload[0].payload);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#00fff210" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: '#00fff270', fontSize: 10 }} axisLine={{ stroke: '#00fff230' }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 10]} tick={{ fill: '#00fff270', fontSize: 10 }} axisLine={{ stroke: '#00fff230' }} width={30} />
                    <Tooltip contentStyle={{ backgroundColor: '#12121a', borderColor: '#00fff2' }} itemStyle={{ fontSize: '12px' }} />
                    <Line type="monotone" dataKey="score" name="Hazard" stroke="#00fff2" strokeWidth={2} dot={{ r: 4, fill: '#00fff2' }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="science" name="Science" stroke="#d946ef" strokeWidth={2} dot={{ r: 3, fill: '#d946ef' }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="absolute top-2 right-6 text-right pointer-events-none flex flex-col gap-2">
                <div>
                    <p className="text-[9px] text-gray-500">HAZARD SCORE</p>
                    <p className={`text-2xl font-bold glow-text ${currentScore > 7 ? 'text-red-500' : 'text-sciFiTeal'}`}>{currentScore}</p>
                </div>
                <div>
                    <p className="text-[9px] text-gray-500">SCIENCE VALUE</p>
                    <p className="text-2xl font-bold glow-text text-purple-400">{currentScience}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN */}
        <div className="col-span-1 md:col-span-6 flex flex-col gap-4">
          <div 
            className="panel relative overflow-hidden group cursor-pointer border-hover-glow transition-all shrink-0 h-64 md:h-96" 
            onClick={() => setIsFullScreen(true)}
          >
            <div className="absolute top-4 left-4 z-10">
                <span className="bg-black/60 text-sciFiTeal border border-sciFiTeal/30 border px-3 py-1 rounded text-xs font-bold backdrop-blur-sm flex items-center gap-2">
                    <span className="animate-pulse">●</span> LIVE FEED
                </span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity z-20"><Maximize2 className="w-12 h-12 text-sciFiTeal" /></div>
            <img 
                src={metadata.imageUrl} 
                className="w-full h-full object-cover rounded-lg transition-transform duration-700 group-hover:scale-105 opacity-90" 
                alt="Mars Rover Feed"
            />
          </div>

          <div className="panel flex flex-col md:flex-row min-h-[400px]">
            {/* DIAGNOSTICS */}
            <div className="flex-1 p-4 border-b md:border-b-0 md:border-r border-teal-900/50 flex flex-col w-full md:w-2/3">
              <h2 className="font-bold text-sciFiTeal mb-3 flex items-center gap-2">
                  <Brain className="w-4 h-4" /> 
                  GEMINI DIAGNOSTICS
              </h2>
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-2 custom-scrollbar">
                {diagnostics.length === 0 ? <span className="text-gray-500 text-xs italic">Waiting for analysis...</span> : 
                  diagnostics.map((diag, i) => (
                    <div key={i} className={`flex items-start gap-2 p-2 rounded ${diag.bg} ${diag.border} ${diag.color === 'text-sciFiTeal' ? 'border-teal-500' : diag.color === 'text-yellow-400' ? 'border-yellow-500' : diag.color === 'text-purple-400' ? 'border-purple-500' : 'border-gray-600'} ${diag.isHeader ? 'mt-2 mb-1 font-bold' : 'ml-2 text-[11px]'}`}>
                      <diag.icon className={`w-4 h-4 mt-0.5 ${diag.color}`} />
                      <span className={`text-xs ${diag.color}`}>{diag.text}</span>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* ACTION STATUS */}
            <div className={`w-full md:w-1/3 p-0 flex flex-col transition-colors duration-500 ${getStatusPanelStyles()}`}>
              <div className={`p-2 border-b text-center shrink-0 transition-colors duration-500 ${getStatusHeaderStyles()}`}>
                <h2 className="font-bold tracking-widest text-[10px]">AUTOMATED ACTION</h2>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-2">
                {renderStatusBox()}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="col-span-1 md:col-span-3 flex flex-col gap-4">
           <div className="panel flex flex-col h-96">
            <div className="p-3 border-b border-teal-900/50 shrink-0">
                <h2 className="font-bold text-sciFiTeal flex items-center gap-2">
                    <List className="w-4 h-4" /> EVENT LOG
                </h2>
            </div>
            <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-2 font-mono text-[11px] bg-black/20 custom-scrollbar">
              {logs.map((log, index) => (
                <div key={index} className={`p-2 rounded border-l-2 opacity-80 ${
                    log.type === 'success' ? 'border-green-500/50 text-green-300' : 
                    log.type === 'danger' ? 'border-red-500/50 text-red-300' : 
                    log.type === 'warning' ? 'border-yellow-500/50 text-yellow-300' :
                    'border-sciFiTeal/30 text-gray-400'
                }`}>
                  <span className="text-gray-500">[{log.time}]</span> {log.msg}
                </div>
              ))}
            </div>
          </div>

          <div className="panel flex flex-col h-[400px]">
              <div className="p-3 border-b border-teal-900/50 shrink-0 bg-teal-900/10">
                  <h3 className="text-xs font-bold text-sciFiTeal tracking-widest flex items-center gap-2">
                      <Database className="w-3 h-3" /> SESSION LOG
                  </h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[9px] text-gray-500 border-b border-gray-800">
                        <th className="pb-1 pl-1">SOL</th>
                        <th className="pb-1">HAZARD</th>
                        <th className="pb-1 text-right pr-1">TERRAIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastMissions.length === 0 ? 
                        <tr><td colSpan="3" className="text-center text-xs text-gray-600 py-4">No data this session</td></tr> 
                    : 
                      pastMissions.map((row, i) => (
                        <tr 
                            key={i} 
                            onClick={() => handleHistoryClick(row)} 
                            className="text-[10px] border-b border-gray-800/50 hover:bg-teal-900/30 transition-colors cursor-pointer group"
                        >
                          <td className="py-2 pl-1 font-mono text-sciFiTeal group-hover:text-white transition-colors">{row.sol}</td>
                          <td className="py-2">
                              <span className={`px-1.5 py-0.5 rounded ${
                                  row.score > 7 ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'
                              }`}>{row.score}</span>
                          </td>
                          <td className="py-2 text-right pr-1 text-gray-400 max-w-[100px] truncate group-hover:text-white" title={row.action}>
                              {row.action}
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
        </div>
      </main>

      {isFullScreen && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-200" onClick={() => setIsFullScreen(false)}>
          <button className="absolute top-6 right-6 text-gray-400 hover:text-white transition-colors" onClick={() => setIsFullScreen(false)}><X className="w-10 h-10" /></button>
          <img src={metadata.imageUrl} className="max-h-full max-w-full object-contain rounded-lg border-2 border-sciFiTeal/30 shadow-[0_0_50px_rgba(0,255,242,0.1)]" alt="Full Screen Rover Feed" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/80 px-4 py-2 rounded text-sciFiTeal border border-teal-900/50 font-mono text-sm">CAM: {metadata.camera} | SOL: {metadata.sol}</div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ icon: Icon, label, value, color = "text-white", highlight = false }) {
  return (
    <div className="flex justify-between border-b border-gray-800 pb-2">
      <span className="text-gray-500 flex items-center gap-2"><Icon className="w-3 h-3" /> {label}:</span>
      <span className={`${highlight ? 'font-bold text-xl' : ''} ${color}`}>{value}</span>
    </div>
  );
}