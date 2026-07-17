import { describe, expect, it } from "vitest";
import {
  parseEvaluateAccessBatchRequest,
  toEvaluateAccessBatchResponse,
} from "./access-evaluation-request.js";

describe("access evaluation request boundary", () => {
  it("parses permission and field checks without accepting a target subject", () => {
    expect(parseEvaluateAccessBatchRequest({
      checks: [
        {
          id: "page.open",
          type: "permission",
          action: "content.read",
          resourceId: "resource:content",
        },
        {
          id: "field.title.write",
          type: "field",
          action: "content.update",
          resourceId: "resource:collection:posts",
          field: "field_title",
          access: "write",
          context: { ownerSubjectId: "subject:owner", status: "draft" },
        },
      ],
    })).toEqual({
      checks: [
        {
          id: "page.open",
          type: "permission",
          action: "content.read",
          resourceId: "resource:content",
        },
        {
          id: "field.title.write",
          type: "field",
          action: "content.update",
          resourceId: "resource:collection:posts",
          field: "field_title",
          access: "write",
          context: { ownerSubjectId: "subject:owner", status: "draft" },
        },
      ],
    });
    expect(() => parseEvaluateAccessBatchRequest({
      checks: [{
        id: "proxy",
        type: "permission",
        subjectId: "subject:other",
        action: "content.read",
        resourceId: "resource:content",
      }],
    })).toThrowError(expect.objectContaining({ code: "ACCESS_BATCH_INVALID", status: 400 }));
  });

  it("rejects malformed discriminators, modes, contexts, and unknown fields", () => {
    for (const body of [
      { checks: "not-an-array" },
      { checks: [{ id: "x", type: "other", action: "content.read", resourceId: "resource:content" }] },
      {
        checks: [{
          id: "x",
          type: "field",
          action: "content.read",
          resourceId: "resource:content",
          field: "title",
          access: "execute",
        }],
      },
      {
        checks: [{
          id: "x",
          type: "permission",
          action: "content.read",
          resourceId: "resource:content",
          context: { targetRoleId: "role:admin" },
        }],
      },
      { checks: [], extra: true },
    ]) {
      expect(() => parseEvaluateAccessBatchRequest(body)).toThrowError(
        expect.objectContaining({ code: "ACCESS_BATCH_INVALID", status: 400 }),
      );
    }
  });

  it("presents one policy revision on permission and field decisions", () => {
    expect(toEvaluateAccessBatchResponse({
      policyRevision: 7,
      items: [
        {
          id: "permission",
          type: "permission",
          resourceId: "resource:content",
          supported: true,
          decision: {
            allowed: false,
            action: "content.read",
            reasonCode: "NO_PERMISSION",
            matchedGrants: [],
          },
        },
        {
          id: "field",
          type: "field",
          action: "content.read",
          supported: true,
          decision: {
            allowed: true,
            access: "read",
            field: "title",
            resourceId: "resource:content",
            reasonCode: "ALLOW_FIELD_UNRESTRICTED",
            matchedGrants: [{
              sourceRoleId: "role:viewer",
              sourceBindingId: "binding:viewer",
              sourceResourceId: "resource:content",
              membershipPath: [],
            }],
          },
        },
      ],
    })).toEqual({
      policyRevision: 7,
      items: [
        {
          id: "permission",
          type: "permission",
          supported: true,
          decision: {
            allowed: false,
            action: "content.read",
            reasonCode: "NO_PERMISSION",
            resourceId: "resource:content",
            policyRevision: 7,
            matchedGrants: [],
          },
        },
        {
          id: "field",
          type: "field",
          action: "content.read",
          supported: true,
          decision: {
            allowed: true,
            access: "read",
            field: "title",
            resourceId: "resource:content",
            reasonCode: "ALLOW_FIELD_UNRESTRICTED",
            policyRevision: 7,
            matchedGrants: [{
              sourceRoleId: "role:viewer",
              sourceBindingId: "binding:viewer",
              sourceResourceId: "resource:content",
              membershipPath: [],
            }],
          },
        },
      ],
    });
  });
});
