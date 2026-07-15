import { describe,expect,it } from "vitest";
import { PluginManifestError,definePlugin,pluginManifestDigest,supports,validatePluginGraph,type XeCmsPluginModule } from "./index.js";

function plugin(id="alpha",dependencies:Record<string,string>={}):XeCmsPluginModule{return{manifest:{manifestVersion:1,id,packageName:`@test/${id}`,version:"1.0.0",displayName:id,compatibility:{core:">=0.4.0 <0.5.0",admin:">=0.4.0 <0.5.0",sdk:"1.x"},dependencies}}}
describe("Plugin SDK manifest",()=>{
  it("accepts only deterministic compatibility ranges",()=>{expect(supports("0.4.9",">=0.4.0 <0.5.0")).toBe(true);expect(supports("0.5.0",">=0.4.0 <0.5.0")).toBe(false);expect(supports("1.7.0","1.x")).toBe(true);expect(supports("1.0.0","^1.0.0")).toBe(false)});
  it("rejects namespace escape before runtime registration",()=>{expect(()=>definePlugin({manifest:{...plugin().manifest,extensions:{permissions:["core.admin"]}}})).toThrow(PluginManifestError)});
  it("rejects runtime declarations that differ from the manifest",()=>{expect(()=>definePlugin({manifest:{...plugin().manifest,extensions:{routes:[{id:"alpha.route",method:"GET",path:"/api/plugins/alpha/route",permission:"alpha.read"}]}},server:{routes:[]}})).toThrow(/runtime route IDs/)});
  it("detects missing dependencies and cycles",()=>{expect(()=>validatePluginGraph([plugin("alpha",{missing:"1.x"})])).toThrow(/missing/);expect(()=>validatePluginGraph([plugin("alpha",{beta:"1.x"}),plugin("beta",{alpha:"1.x"})])).toThrow(/cycle/)});
  it("produces a key-order-independent manifest digest",()=>{const first=plugin().manifest;const second={...first,compatibility:{sdk:"1.x",admin:">=0.4.0 <0.5.0",core:">=0.4.0 <0.5.0"}};expect(pluginManifestDigest(first)).toBe(pluginManifestDigest(second))});
});
