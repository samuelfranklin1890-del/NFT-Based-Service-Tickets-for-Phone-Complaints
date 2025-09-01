import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Metadata {
  hash: string;
  description: string;
  complaintType: string;
}

interface LogEntry {
  updater: string;
  timestamp: number;
  note: string;
}

interface TicketDetails {
  owner?: string;
  metadata?: Metadata;
  status?: string;
  logs?: LogEntry[];
}

interface ContractState {
  ticketOwners: Map<number, string>;
  ticketMetadata: Map<number, Metadata>;
  ticketStatus: Map<number, string>;
  updateLogs: Map<number, LogEntry[]>;
  approvals: Map<number, string>;
  operatorApprovals: Map<string, boolean>; // Changed to string key
  lastId: number;
  contractOwner: string;
  paused: boolean;
  nftOwners: Map<number, string>;
}

// Mock contract implementation
class TicketNFTMock {
  private state: ContractState = {
    ticketOwners: new Map(),
    ticketMetadata: new Map(),
    ticketStatus: new Map(),
    updateLogs: new Map(),
    approvals: new Map(),
    operatorApprovals: new Map(),
    lastId: 0,
    contractOwner: "deployer",
    paused: false,
    nftOwners: new Map(),
  };

  private STATUS_OPEN = "open";
  private STATUS_IN_PROGRESS = "in-progress";
  private STATUS_RESOLVED = "resolved";

  private ERR_NOT_AUTHORIZED = 100;
  private ERR_INVALID_ID = 101;
  private ERR_PAUSED = 103;
  private ERR_INVALID_STATUS = 104;
  private ERR_NOT_OWNER = 105;
  private ERR_MAX_LOGS_REACHED = 106;
  private ERR_INVALID_METADATA = 107;

  private MAX_METADATA_DESC_LEN = 500;
  private MAX_LOG_ENTRIES = 50;

  private getOperatorKey(owner: string, operator: string): string {
    return `${owner}:${operator}`;
  }

  setOwner(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  mint(caller: string, recipient: string, metadataHash: string, description: string, complaintType: string): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (description.length === 0 || description.length > this.MAX_METADATA_DESC_LEN) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const newId = this.state.lastId + 1;
    this.state.nftOwners.set(newId, recipient);
    this.state.ticketOwners.set(newId, recipient);
    this.state.ticketMetadata.set(newId, { hash: metadataHash, description, complaintType });
    this.state.ticketStatus.set(newId, this.STATUS_OPEN);
    this.state.updateLogs.set(newId, [{ updater: caller, timestamp: Date.now(), note: "Ticket minted" }]);
    this.state.lastId = newId;
    return { ok: true, value: newId };
  }

  burn(caller: string, id: number): ClarityResponse<boolean> {
    const owner = this.state.nftOwners.get(id);
    if (!owner) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isApproved(id, caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if ((this.state.ticketStatus.get(id) || this.STATUS_OPEN) !== this.STATUS_RESOLVED) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.nftOwners.delete(id);
    this.state.ticketOwners.delete(id);
    this.state.ticketMetadata.delete(id);
    this.state.ticketStatus.delete(id);
    this.state.updateLogs.delete(id);
    this.state.approvals.delete(id);
    return { ok: true, value: true };
  }

  getOwner(id: number): ClarityResponse<string | undefined> {
    return { ok: true, value: this.state.ticketOwners.get(id) };
  }

  getMetadata(id: number): ClarityResponse<Metadata | undefined> {
    return { ok: true, value: this.state.ticketMetadata.get(id) };
  }

  getStatus(id: number): ClarityResponse<string> {
    return { ok: true, value: this.state.ticketStatus.get(id) || this.STATUS_OPEN };
  }

  getLog(id: number): ClarityResponse<LogEntry[]> {
    return { ok: true, value: this.state.updateLogs.get(id) || [] };
  }

  transfer(caller: string, id: number, sender: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const owner = this.state.nftOwners.get(id);
    if (!owner || owner !== sender) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    this.state.nftOwners.set(id, recipient);
    this.state.ticketOwners.set(id, recipient);
    this.state.approvals.delete(id);
    return { ok: true, value: true };
  }

  approve(caller: string, id: number, operator: string): ClarityResponse<boolean> {
    const owner = this.state.nftOwners.get(id);
    if (!owner) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (caller !== owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.approvals.set(id, operator);
    return { ok: true, value: true };
  }

  revokeApproval(caller: string, id: number): ClarityResponse<boolean> {
    const owner = this.state.nftOwners.get(id);
    if (!owner) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (caller !== owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.approvals.delete(id);
    return { ok: true, value: true };
  }

  getApproved(id: number): ClarityResponse<string | undefined> {
    return { ok: true, value: this.state.approvals.get(id) };
  }

  setApprovalForAll(caller: string, operator: string, approved: boolean): ClarityResponse<boolean> {
    this.state.operatorApprovals.set(this.getOperatorKey(caller, operator), approved);
    return { ok: true, value: true };
  }

  isApprovedForAll(owner: string, operator: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.operatorApprovals.get(this.getOperatorKey(owner, operator)) || false };
  }

  private isApproved(id: number, operator: string): boolean {
    const owner = this.state.nftOwners.get(id);
    if (!owner) return false;
    if (owner === operator) return true;
    if (this.state.approvals.get(id) === operator) return true;
    if (this.state.operatorApprovals.get(this.getOperatorKey(owner, operator))) return true;
    return false;
  }

  updateStatus(caller: string, id: number, newStatus: string, note: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.nftOwners.has(id)) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (!this.isApproved(id, caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (![this.STATUS_OPEN, this.STATUS_IN_PROGRESS, this.STATUS_RESOLVED].includes(newStatus)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.ticketStatus.set(id, newStatus);
    let currentLogs = this.state.updateLogs.get(id) || [];
    if (currentLogs.length >= this.MAX_LOG_ENTRIES) {
      return { ok: false, value: this.ERR_MAX_LOGS_REACHED };
    }
    currentLogs.push({ updater: caller, timestamp: Date.now(), note });
    this.state.updateLogs.set(id, currentLogs);
    return { ok: true, value: true };
  }

  getLastId(): ClarityResponse<number> {
    return { ok: true, value: this.state.lastId };
  }

  getTicketDetails(id: number): ClarityResponse<TicketDetails> {
    return {
      ok: true,
      value: {
        owner: this.state.ticketOwners.get(id),
        metadata: this.state.ticketMetadata.get(id),
        status: this.state.ticketStatus.get(id),
        logs: this.state.updateLogs.get(id),
      },
    };
  }

  isValidTicket(id: number): ClarityResponse<boolean> {
    return { ok: true, value: this.state.nftOwners.has(id) };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
  agent: "wallet_3",
};

describe("TicketNFT Contract", () => {
  let contract: TicketNFTMock;

  beforeEach(() => {
    contract = new TicketNFTMock();
  });

  it("should initialize correctly", () => {
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
    expect(contract.getLastId()).toEqual({ ok: true, value: 0 });
  });

  it("should allow owner to pause and unpause", () => {
    const pause = contract.pause(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const mintDuringPause = contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    expect(mintDuringPause).toEqual({ ok: false, value: 103 });

    const unpause = contract.unpause(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-owner from pausing", () => {
    const pause = contract.pause(accounts.user1);
    expect(pause).toEqual({ ok: false, value: 100 });
  });

  it("should mint a new ticket", () => {
    const mint = contract.mint(accounts.deployer, accounts.user1, "metadatahash", "Test description", "hardware");
    expect(mint).toEqual({ ok: true, value: 1 });
    expect(contract.getOwner(1)).toEqual({ ok: true, value: accounts.user1 });
    expect(contract.getStatus(1)).toEqual({ ok: true, value: "open" });
    expect(contract.getLog(1)).toEqual({
      ok: true,
      value: expect.arrayContaining([expect.objectContaining({ note: "Ticket minted" })]),
    });
    expect(contract.getTicketDetails(1)).toEqual({
      ok: true,
      value: expect.objectContaining({ owner: accounts.user1 }),
    });
    expect(contract.isValidTicket(1)).toEqual({ ok: true, value: true });
  });

  it("should prevent mint with invalid metadata", () => {
    const longDesc = "a".repeat(501);
    const mint = contract.mint(accounts.deployer, accounts.user1, "hash", longDesc, "type");
    expect(mint).toEqual({ ok: false, value: 107 });
  });

  it("should allow transfer", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const transfer = contract.transfer(accounts.user1, 1, accounts.user1, accounts.user2);
    expect(transfer).toEqual({ ok: true, value: true });
    expect(contract.getOwner(1)).toEqual({ ok: true, value: accounts.user2 });
  });

  it("should prevent unauthorized transfer", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const transfer = contract.transfer(accounts.user2, 1, accounts.user1, accounts.user2);
    expect(transfer).toEqual({ ok: false, value: 100 });
  });

  it("should allow approval and approved transfer", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const approve = contract.approve(accounts.user1, 1, accounts.agent);
    expect(approve).toEqual({ ok: true, value: true });
    expect(contract.getApproved(1)).toEqual({ ok: true, value: accounts.agent });

    // Note: Clarity contract restricts transfer to sender == caller, so we can't test approved transfer directly in mock
    const transferByApproved = contract.transfer(accounts.agent, 1, accounts.user1, accounts.user2);
    expect(transferByApproved).toEqual({ ok: false, value: 100 });
  });

  it("should allow operator approval", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const setApproval = contract.setApprovalForAll(accounts.user1, accounts.agent, true);
    expect(setApproval).toEqual({ ok: true, value: true });
    const isApproved = contract.isApprovedForAll(accounts.user1, accounts.agent);
    expect(isApproved).toEqual({ ok: true, value: true });
  });

  it("should update status", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const update = contract.updateStatus(accounts.user1, 1, "in-progress", "Updated by owner");
    expect(update).toEqual({ ok: true, value: true });
    expect(contract.getStatus(1)).toEqual({ ok: true, value: "in-progress" });
    const logs = contract.getLog(1);
    expect(logs.ok).toBe(true);
    expect(Array.isArray(logs.value)).toBe(true);
    expect((logs.value as LogEntry[]).length).toBe(2);
  });

  it("should prevent max logs exceeded", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    for (let i = 0; i < 50; i++) {
      contract.updateStatus(accounts.user1, 1, "in-progress", `Note ${i}`);
    }
    const exceed = contract.updateStatus(accounts.user1, 1, "resolved", "Exceed");
    expect(exceed).toEqual({ ok: false, value: 106 });
  });

  it("should burn resolved ticket", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    contract.updateStatus(accounts.user1, 1, "resolved", "Resolved");
    const burn = contract.burn(accounts.user1, 1);
    expect(burn).toEqual({ ok: true, value: true });
    expect(contract.isValidTicket(1)).toEqual({ ok: true, value: false });
  });

  it("should prevent burn of non-resolved ticket", () => {
    contract.mint(accounts.deployer, accounts.user1, "hash", "desc", "type");
    const burn = contract.burn(accounts.user1, 1);
    expect(burn).toEqual({ ok: false, value: 104 });
  });
});