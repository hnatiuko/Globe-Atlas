// GlobeAtlas — Interactive travel map in a single React file
// -----------------------------------------------------------
// Quick start:
// 1) Add your Mapbox access token below (get one at https://account.mapbox.com)
// 2) Drop this file into a React project (or run in the Canvas preview)
// 3) Pan/zoom the map, add pins, and build simple trip routes. Data is saved to localStorage.
//
// Notes:
// - Comments are in English, per user preference.
// - UI uses Tailwind + shadcn/ui conventions; all imports are available in this environment.
// - No backend required; you can later replace the storage layer with your own API.

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MapPin, RouteIcon, Plus, Trash2, Save, Undo2, Redo2 } from "lucide-react";

// ==== Configuration ====
mapboxgl.accessToken = process.env.MAPBOX_TOKEN || "YOUR_MAPBOX_ACCESS_TOKEN_HERE"; // <-- replace

// ==== Types (JSDoc for clarity) ====
/**
 * @typedef {Object} Pin
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} category // e.g., food | museum | nature | stay | other
 * @property {string} date // ISO string (yyyy-mm-dd)
 * @property {number[]} lngLat // [lng, lat]
 */

/**
 * @typedef {Object} Trip
 * @property {string} id
 * @property {string} name
 * @property {string[]} pinIds // ordered pins composing the path
 */

// ==== Local storage helpers ====
const LS_KEYS = {
  pins: "globeatlas:pins",
  trips: "globeatlas:trips",
  history: "globeatlas:history", // for undo/redo
  future: "globeatlas:future"
};

const loadJSON = (k, def) => {
  try { return JSON.parse(localStorage.getItem(k) || "") ?? def; } catch { return def; }
};
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Simple history stack for undo/redo
const pushHistory = (state) => {
  const hist = loadJSON(LS_KEYS.history, []);
  hist.push(state);
  saveJSON(LS_KEYS.history, hist);
  // clear future on new action
  saveJSON(LS_KEYS.future, []);
};
const popHistory = () => {
  const hist = loadJSON(LS_KEYS.history, []);
  return hist.pop();
};
const pushFuture = (state) => {
  const fut = loadJSON(LS_KEYS.future, []);
  fut.push(state);
  saveJSON(LS_KEYS.future, fut);
};
const popFuture = () => {
  const fut = loadJSON(LS_KEYS.future, []);
  return fut.pop();
};

// ==== Seed data (optional) ====
const SEED_PINS = [
  {
    id: crypto.randomUUID(),
    title: "Helsinki Cathedral",
    description: "Neoclassical landmark in Senate Square.",
    category: "landmark",
    date: new Date().toISOString().slice(0, 10),
    lngLat: [24.9525, 60.1706]
  },
  {
    id: crypto.randomUUID(),
    title: "Suomenlinna Sea Fortress",
    description: "UNESCO World Heritage site across Helsinki's harbor.",
    category: "history",
    date: new Date().toISOString().slice(0, 10),
    lngLat: [24.9899, 60.1460]
  }
];

const categories = [
  { key: "landmark", label: "Landmark" },
  { key: "food", label: "Food" },
  { key: "museum", label: "Museum" },
  { key: "nature", label: "Nature" },
  { key: "stay", label: "Stay" },
  { key: "other", label: "Other" },
];

export default function GlobeAtlas() {
  // ==== App state ====
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);

  const [pins, setPins] = useState(() => loadJSON(LS_KEYS.pins, SEED_PINS));
  const [trips, setTrips] = useState(() => loadJSON(LS_KEYS.trips, []));
  const [selectedPinId, setSelectedPinId] = useState(null);
  const [draftPin, setDraftPin] = useState({ title: "", description: "", category: "landmark", date: new Date().toISOString().slice(0,10) });
  const [draftLngLat, setDraftLngLat] = useState(null);
  const [newTripName, setNewTripName] = useState("");
  const [activeTripId, setActiveTripId] = useState(null);

  // Persist state
  useEffect(() => saveJSON(LS_KEYS.pins, pins), [pins]);
  useEffect(() => saveJSON(LS_KEYS.trips, trips), [trips]);

  // ==== Initialize map ====
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    // Create Mapbox map
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [24.9384, 60.1699], // Helsinki
      zoom: 11
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(new mapboxgl.FullscreenControl());
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }));

    // Geolocate control
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }));

    // Handle map clicks to place draft pin
    map.on("click", (e) => {
      const { lng, lat } = e.lngLat;
      setDraftLngLat([lng, lat]);
    });

    mapRef.current = map;

    return () => map.remove();
  }, []);

  // ==== Render pins on map ====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing markers to avoid duplicates
    if (map.__globeMarkers) {
      map.__globeMarkers.forEach(m => m.remove());
    }

    const markers = pins.map((p) => {
      const el = document.createElement("div");
      el.className = "rounded-full shadow-lg ring-2 ring-white p-1 bg-white";

      // Simple colored dot based on category (CSS-only to avoid inline styles)
      const dot = document.createElement("div");
      dot.className = "w-3 h-3 rounded-full";
      // Map category to a Tailwind utility via data-attr class map (kept simple)
      const colorClass = {
        landmark: "bg-blue-500",
        food: "bg-amber-500",
        museum: "bg-purple-500",
        nature: "bg-green-600",
        stay: "bg-rose-500",
        other: "bg-gray-500",
      }[p.category] || "bg-gray-500";
      dot.className += ` ${colorClass}`;
      el.appendChild(dot);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(p.lngLat)
        .addTo(map);

      // Popup
      const popupNode = document.createElement("div");
      popupNode.className = "min-w-[220px]";
      popupNode.innerHTML = `
        <div class="font-semibold text-sm mb-1">${escapeHtml(p.title)}</div>
        <div class="text-xs text-muted-foreground mb-1">${escapeHtml(p.category)} • ${escapeHtml(p.date)}</div>
        <div class="text-xs">${escapeHtml(p.description)}</div>
      `;
      const popup = new mapboxgl.Popup({ offset: 12 }).setDOMContent(popupNode);
      marker.setPopup(popup);

      el.addEventListener("click", () => setSelectedPinId(p.id));

      return marker;
    });

    map.__globeMarkers = markers;
  }, [pins]);

  // ==== Draw active trip line ====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const trip = trips.find(t => t.id === activeTripId);
    const coords = (trip?.pinIds || [])
      .map(id => pins.find(p => p.id === id)?.lngLat)
      .filter(Boolean);

    const sourceId = "globeatlas-trip";
    const layerId = "globeatlas-trip-line";

    // Ensure source exists
    if (map.getSource(sourceId)) {
      map.removeLayer(layerId);
      map.removeSource(sourceId);
    }

    if (coords.length >= 2) {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {}
        }
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-width": 4,
          "line-color": "#2563eb", // blue-600
          "line-opacity": 0.9
        }
      });

      // Fit bounds to the trip
      const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: 60, duration: 800 });
    }
  }, [activeTripId, trips, pins]);

  // ==== Actions ====
  const addPin = () => {
    if (!draftLngLat) return;
    const pin = {
      id: crypto.randomUUID(),
      title: draftPin.title || "Untitled place",
      description: draftPin.description || "",
      category: draftPin.category,
      date: draftPin.date || new Date().toISOString().slice(0,10),
      lngLat: draftLngLat,
    };

    pushHistory({ pins, trips });
    setPins(prev => [pin, ...prev]);
    setDraftLngLat(null);
    setDraftPin({ title: "", description: "", category: "landmark", date: new Date().toISOString().slice(0,10) });
  };

  const deletePin = (id) => {
    pushHistory({ pins, trips });
    setPins(prev => prev.filter(p => p.id !== id));
    setTrips(prev => prev.map(t => ({ ...t, pinIds: t.pinIds.filter(pid => pid !== id) })));
    if (selectedPinId === id) setSelectedPinId(null);
  };

  const createTrip = () => {
    if (!newTripName.trim()) return;
    pushHistory({ pins, trips });
    const trip = { id: crypto.randomUUID(), name: newTripName.trim(), pinIds: [] };
    setTrips(prev => [trip, ...prev]);
    setNewTripName("");
    setActiveTripId(trip.id);
  };

  const togglePinInTrip = (tripId, pinId) => {
    pushHistory({ pins, trips });
    setTrips(prev => prev.map(t => {
      if (t.id !== tripId) return t;
      const exists = t.pinIds.includes(pinId);
      return {
        ...t,
        pinIds: exists ? t.pinIds.filter(id => id !== pinId) : [...t.pinIds, pinId]
      };
    }));
  };

  const reorderTripPins = (tripId, pinId, direction) => {
    pushHistory({ pins, trips });
    setTrips(prev => prev.map(t => {
      if (t.id !== tripId) return t;
      const idx = t.pinIds.indexOf(pinId);
      if (idx === -1) return t;
      const next = [...t.pinIds];
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= next.length) return t;
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return { ...t, pinIds: next };
    }));
  };

  const deleteTrip = (tripId) => {
    pushHistory({ pins, trips });
    setTrips(prev => prev.filter(t => t.id !== tripId));
    if (activeTripId === tripId) setActiveTripId(null);
  };

  const undo = () => {
    const prev = popHistory();
    if (!prev) return;
    const current = { pins, trips };
    pushFuture(current);
    setPins(prev.pins);
    setTrips(prev.trips);
    saveJSON(LS_KEYS.history, loadJSON(LS_KEYS.history, []).slice(0, -1));
  };

  const redo = () => {
    const fut = popFuture();
    if (!fut) return;
    pushHistory({ pins, trips });
    setPins(fut.pins);
    setTrips(fut.trips);
    saveJSON(LS_KEYS.future, loadJSON(LS_KEYS.future, []).slice(0, -1));
  };

  // ==== Derived state ====
  const selectedPin = useMemo(() => pins.find(p => p.id === selectedPinId) || null, [pins, selectedPinId]);

  // ==== UI ====
  return (
    <div className="w-full h-screen grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside className="bg-white border-r hidden lg:flex flex-col">
        <div className="p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">GlobeAtlas</h1>
            <p className="text-sm text-muted-foreground">Map your journeys & stories</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={undo} title="Undo"><Undo2 className="w-4 h-4"/></Button>
            <Button variant="outline" size="icon" onClick={redo} title="Redo"><Redo2 className="w-4 h-4"/></Button>
          </div>
        </div>
        <Separator />

        <Tabs defaultValue="pins" className="flex-1 flex flex-col">
          <div className="p-4">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="pins">Pins</TabsTrigger>
              <TabsTrigger value="trips">Trips</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="pins" className="flex-1 overflow-hidden">
            <div className="px-4 pb-4 space-y-3">
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><MapPin className="w-4 h-4"/> Add a pin</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Title" value={draftPin.title} onChange={e => setDraftPin(s => ({...s, title: e.target.value}))} />
                    <Input type="date" value={draftPin.date} onChange={e => setDraftPin(s => ({...s, date: e.target.value}))} />
                  </div>
                  <Textarea placeholder="Description" value={draftPin.description} onChange={e => setDraftPin(s => ({...s, description: e.target.value}))} />
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <Select value={draftPin.category} onValueChange={(v) => setDraftPin(s => ({...s, category: v}))}>
                      <SelectTrigger><SelectValue placeholder="Category"/></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={addPin} disabled={!draftLngLat} className="flex items-center gap-2"><Plus className="w-4 h-4"/> Drop here</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Tip: Click on the map to choose a location, then press "Drop here".</p>
                </CardContent>
              </Card>

              <Separator />

              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Your pins</h3>
                <Badge variant="secondary">{pins.length}</Badge>
              </div>

              <ScrollArea className="h-[42vh] pr-2">
                <div className="space-y-2">
                  {pins.map(p => (
                    <Card key={p.id} className={`shadow-sm ${selectedPinId===p.id ? "ring-2 ring-blue-500" : ""}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-1"><span className={`inline-block w-2.5 h-2.5 rounded-full ${categoryColor(p.category)}`}/></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <div className="font-medium truncate">{p.title}</div>
                              <div className="text-xs text-muted-foreground ml-3">{p.date}</div>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{p.category}</div>
                            <div className="text-sm mt-1 line-clamp-2">{p.description}</div>
                            <div className="flex items-center gap-2 mt-2">
                              <Button size="sm" variant="outline" onClick={() => setSelectedPinId(p.id)}>Focus</Button>
                              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => deletePin(p.id)}>
                                <Trash2 className="w-4 h-4 mr-1"/> Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="trips" className="flex-1 overflow-hidden">
            <div className="px-4 pb-4 space-y-3">
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><RouteIcon className="w-4 h-4"/> Create a trip</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input placeholder="Trip name (e.g., Baltic Tour)" value={newTripName} onChange={(e)=>setNewTripName(e.target.value)} />
                    <Button onClick={createTrip}><Save className="w-4 h-4 mr-1"/> Save</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Then, add/remove pins below to define the route. Select a trip to visualize the path on the map.</p>
                </CardContent>
              </Card>

              <Separator />

              <div className="space-y-2">
                {trips.length === 0 && (
                  <p className="text-sm text-muted-foreground">No trips yet. Create one above.</p>
                )}

                {trips.map(t => (
                  <Card key={t.id} className={`shadow-sm ${activeTripId===t.id ? "ring-2 ring-blue-500" : ""}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{t.name}</div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setActiveTripId(t.id)}>Show</Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => deleteTrip(t.id)}><Trash2 className="w-4 h-4 mr-1"/>Delete</Button>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground">Pins in trip ({t.pinIds.length})</div>

                      <div className="flex flex-wrap gap-2">
                        {pins.map(p => {
                          const inTrip = t.pinIds.includes(p.id);
                          return (
                            <Button key={p.id} size="sm" variant={inTrip?"default":"outline"} onClick={() => togglePinInTrip(t.id, p.id)}>
                              {inTrip ? "✓" : "+"} {p.title}
                            </Button>
                          );
                        })}
                      </div>

                      {t.pinIds.length > 1 && (
                        <div className="space-y-2">
                          <Separator/>
                          <div className="text-xs text-muted-foreground">Reorder (first → last)</div>
                          <div className="flex flex-col gap-1">
                            {t.pinIds.map(pid => {
                              const p = pins.find(pp => pp.id === pid);
                              if (!p) return null;
                              return (
                                <div key={pid} className="flex items-center justify-between bg-muted/50 rounded-xl px-3 py-2">
                                  <div className="text-sm truncate">{p.title}</div>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="outline" onClick={() => reorderTripPins(t.id, pid, "up")}>↑</Button>
                                    <Button size="icon" variant="outline" onClick={() => reorderTripPins(t.id, pid, "down")}>↓</Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </aside>

      {/* Map area */}
      <main className="relative">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="absolute top-3 left-3 right-3 lg:left-0 lg:right-0 z-10 flex lg:justify-center">
          <Card className="px-4 py-2 bg-white/90 backdrop-blur shadow-xl border-0">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Click the map to set a location</span>
              <Badge variant="secondary" className="hidden md:inline-flex">Local-only storage</Badge>
              <Badge className="hidden md:inline-flex">Helsinki demo data</Badge>
            </div>
          </Card>
        </motion.div>

        <div ref={mapContainerRef} className="w-full h-full"/>

        {/* Floating selected pin card */}
        {selectedPin && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
            className="absolute right-3 bottom-3 z-10 max-w-md">
            <Card className="shadow-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{selectedPin.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-xs text-muted-foreground">{selectedPin.category} • {selectedPin.date}</div>
                <div className="text-sm">{selectedPin.description}</div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => flyTo(selectedPin.lngLat, mapRef)}>Fly to</Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => deletePin(selectedPin.id)}><Trash2 className="w-4 h-4 mr-1"/>Delete</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </main>
    </div>
  );
}

// ==== Utilities ====
function flyTo(lngLat, mapRef) {
  const map = mapRef.current;
  if (!map) return;
  map.flyTo({ center: lngLat, zoom: 13, speed: 0.8, curve: 1.4, essential: true });
}

function categoryColor(cat) {
  return {
    landmark: "bg-blue-500",
    food: "bg-amber-500",
    museum: "bg-purple-500",
    nature: "bg-green-600",
    stay: "bg-rose-500",
    other: "bg-gray-500",
  }[cat] || "bg-gray-500";
}

function escapeHtml(unsafe) {
  if (typeof unsafe !== "string") return "";
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
