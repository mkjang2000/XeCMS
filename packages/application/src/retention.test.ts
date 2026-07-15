import { describe, expect, it } from "vitest";
import { RetentionService, type RetentionPlan, type RetentionPolicy, type RetentionStore } from "./retention.js";

const policy:RetentionPolicy={workspaceId:"wrk",auditDays:90,dispatchedOutboxDays:30,succeededDeliveryDays:30,deadDeliveryDays:null,expiredSessionDays:7,softDeletedDocumentDays:null,revision:3,updatedAt:"2026-07-15T00:00:00.000Z",updatedBy:"owner"};
const empty={systemAudit:0,documentAudit:0,authorizationAudit:0,dispatchedOutbox:0,succeededDeliveries:0,deadDeliveries:0,expiredSessions:0,softDeletedDocuments:0};

class Store implements RetentionStore{
  lastCreate:Parameters<RetentionStore["createPlan"]>[0]|undefined;
  async getPolicy(){return policy}
  async updatePolicy(input:Parameters<RetentionStore["updatePolicy"]>[0]){return{...policy,...input,revision:4,updatedAt:input.now,updatedBy:input.actorIdentityId}}
  async createPlan(input:Parameters<RetentionStore["createPlan"]>[0]){this.lastCreate=input;return{id:input.id,workspaceId:input.workspaceId,policyRevision:input.expectedPolicyRevision,status:"previewed" as const,referenceAt:input.referenceAt,cutoffs:input.cutoffs,counts:empty,estimatedBytes:{},digest:input.digestSeed,createdAt:input.createdAt,createdBy:input.createdBy,expiresAt:input.expiresAt}}
  async getPlan(_workspaceId:string,_planId:string):Promise<RetentionPlan|null>{return null}
  async applyPlan():Promise<RetentionPlan>{throw new Error("unused")}
}

describe("RetentionService",()=>{
  it("creates a 15-minute durable preview with deterministic UTC cutoffs",async()=>{
    const store=new Store();
    const service=new RetentionService(store,{now:()=>"2026-07-15T00:00:00.000Z",newPlanId:()=>"plan_1"});
    const plan=await service.preview({workspaceId:"wrk",expectedPolicyRevision:3,actorIdentityId:"owner"});
    expect(plan).toMatchObject({id:"plan_1",expiresAt:"2026-07-15T00:15:00.000Z",cutoffs:{audit:"2026-04-16T00:00:00.000Z",deadDelivery:null,expiredSession:"2026-07-08T00:00:00.000Z"}});
    expect(store.lastCreate?.digestSeed).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects stale preview revisions before creating a plan",async()=>{
    const store=new Store();
    const service=new RetentionService(store,{now:()=>policy.updatedAt,newPlanId:()=>"unused"});
    await expect(service.preview({workspaceId:"wrk",expectedPolicyRevision:2,actorIdentityId:"owner"})).rejects.toMatchObject({code:"RETENTION_POLICY_REVISION_CONFLICT",status:409});
    expect(store.lastCreate).toBeUndefined();
  });
  it("validates category-specific minimum retention periods",async()=>{
    const service=new RetentionService(new Store(),{now:()=>policy.updatedAt,newPlanId:()=>"unused"});
    expect(()=>service.updatePolicy({workspaceId:"wrk",expectedRevision:3,auditDays:89,dispatchedOutboxDays:7,succeededDeliveryDays:7,deadDeliveryDays:30,expiredSessionDays:1,softDeletedDocumentDays:1,actorIdentityId:"owner",actorSubjectId:"owner"})).toThrow(expect.objectContaining({code:"RETENTION_POLICY_INVALID",status:422}));
  });
});
