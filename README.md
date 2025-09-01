# PhoneCare: NFT-Based Service Tickets for Phone Complaints

## Overview

PhoneCare is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It transforms customer service tickets for phone-related complaints (e.g., hardware issues, network problems, billing disputes) into non-fungible tokens (NFTs). These NFT tickets are trackable across virtual agents (e.g., chatbots, online support portals) and in-person stores, providing a decentralized, immutable record of the complaint lifecycle.

The system solves real-world problems in customer service:
- **Lack of Transparency and Tracking**: Traditional tickets are siloed in centralized systems, making it hard to follow progress across channels. PhoneCare uses blockchain for a unified, tamper-proof history.
- **Customer Frustration with Lost or Duplicated Tickets**: NFTs ensure uniqueness and ownership—customers "own" their ticket and can verify updates anytime.
- **Agent Accountability**: Updates require authenticated agents, reducing errors and fraud.
- **Cross-Channel Inefficiency**: The same NFT ID works online or in-store, with QR codes or wallet scans for verification.
- **Resolution Delays and Incentives**: Integrates a token system to reward timely resolutions, encouraging better service.
- **Data Privacy and Auditability**: Sensitive details are stored off-chain (hashed on-chain), but the lifecycle is publicly auditable.

The project involves 6 core smart contracts written in Clarity, deployed on Stacks (which settles on Bitcoin for security). Users interact via a dApp (not included here; assume a frontend like React with Hiro Wallet integration).

## Tech Stack
- **Blockchain**: Stacks (STX)
- **Smart Contract Language**: Clarity (secure, decidable, no reentrancy bugs)
- **NFT Standard**: Inspired by SIP-009 (Stacks NFT trait)
- **Token Standard**: SIP-010 for fungible tokens (if used for rewards)
- **Off-Chain Integration**: IPFS for metadata storage, oracles for real-time agent verification (not implemented here)
- **Deployment**: Use Clarinet for local testing, Stacks CLI for mainnet deployment

## Architecture

The system flow:
1. Customer submits a complaint via dApp or app, minting an NFT ticket.
2. Virtual agents or in-store staff (registered) update the ticket status.
3. Updates are logged immutably.
4. Upon resolution, the ticket is "closed," and rewards may be distributed.
5. Customers can query ticket history anytime.

### Smart Contracts

The project consists of 6 solid Clarity smart contracts. Each is designed for modularity, security (read-only where possible, error handling), and efficiency. Below are descriptions and full code listings.

#### 1. TicketNFT.clar
This contract defines the NFT trait and handles minting/burning of tickets. It uses SIP-009 compliance.

```clarity
;; TicketNFT Contract
;; Defines NFT for service tickets

(define-trait nft-trait
  (
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  )
)

(define-non-fungible-token ticket-nft uint)

(define-map ticket-owners uint principal)
(define-map ticket-metadata uint (string-ascii 256)) ;; Hash of off-chain metadata

(define-data-var last-id uint u0)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-ID u101)

(define-public (mint (recipient principal) (metadata-hash (string-ascii 256)))
  (let ((new-id (+ (var-get last-id) u1)))
    (try! (nft-mint? ticket-nft new-id recipient))
    (map-set ticket-owners new-id recipient)
    (map-set ticket-metadata new-id metadata-hash)
    (var-set last-id new-id)
    (ok new-id)
  )
)

(define-public (burn (id uint))
  (let ((owner (unwrap! (nft-get-owner? ticket-nft id) (err ERR-INVALID-ID))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
    (try! (nft-burn? ticket-nft id owner))
    (map-delete ticket-owners id)
    (map-delete ticket-metadata id)
    (ok true)
  )
)

(define-read-only (get-owner (id uint))
  (ok (map-get? ticket-owners id))
)

(define-read-only (get-metadata (id uint))
  (ok (map-get? ticket-metadata id))
)

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (try! (nft-transfer? ticket-nft id sender recipient))
    (map-set ticket-owners id recipient)
    (ok true)
  )
)
```

#### 2. AgentRegistry.clar
Registers and authenticates agents (virtual or in-person). Only registered agents can update tickets.

```clarity
;; AgentRegistry Contract
;; Manages agent registration and roles

(define-map agents principal { role: (string-ascii 32), active: bool })
(define-map agent-nonces principal uint)

(define-data-var owner principal tx-sender)

(define-constant ROLE_VIRTUAL "virtual")
(define-constant ROLE_IN_PERSON "in-person")
(define-constant ERR-NOT-OWNER u200)
(define-constant ERR-ALREADY-REGISTERED u201)
(define-constant ERR-NOT-REGISTERED u202)

(define-public (register-agent (agent principal) (role (string-ascii 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (asserts! (is-none (map-get? agents agent)) (err ERR-ALREADY-REGISTERED))
    (map-set agents agent { role: role, active: true })
    (ok true)
  )
)

(define-public (deactivate-agent (agent principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (match (map-get? agents agent)
      some-agent (map-set agents agent (merge some-agent { active: false }))
      (err ERR-NOT-REGISTERED)
    )
    (ok true)
  )
)

(define-read-only (is-agent-active (agent principal))
  (match (map-get? agents agent)
    some-agent (ok (get active some-agent))
    (ok false)
  )
)

(define-read-only (get-agent-role (agent principal))
  (match (map-get? agents agent)
    some-agent (ok (get role some-agent))
    (err ERR-NOT-REGISTERED)
  )
)
```

#### 3. StatusUpdater.clar
Handles status updates to tickets. Requires agent authentication.

```clarity
;; StatusUpdater Contract
;; Updates ticket statuses with agent auth

(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XzHP9JC3Z0pOPMF9F3G3.TicketNFT.nft-trait)

(define-map ticket-status uint (string-ascii 64)) ;; e.g., "open", "in-progress", "resolved"
(define-map update-logs uint (list 100 { updater: principal, timestamp: uint, note: (string-ascii 256) }))

(define-constant STATUS_OPEN "open")
(define-constant STATUS_IN_PROGRESS "in-progress")
(define-constant STATUS_RESOLVED "resolved")
(define-constant ERR-NOT-AGENT u300)
(define-constant ERR-INVALID-STATUS u301)

(define-public (update-status (ticket-id uint) (new-status (string-ascii 64)) (note (string-ascii 256)) (nft-contract <nft-trait>))
  (let ((owner (unwrap! (as-contract (contract-call? nft-contract get-owner ticket-id)) (err u0))))
    (asserts! (unwrap! (contract-call? 'SP2PABAF9FTAJYNFZH93XzHP9JC3Z0pOPMF9F3G3.AgentRegistry is-agent-active tx-sender) (err ERR-NOT-AGENT)) (err ERR-NOT-AGENT))
    (map-set ticket-status ticket-id new-status)
    (map-set update-logs ticket-id
      (unwrap! (as-max-len? (append (default-to (list) (map-get? update-logs ticket-id)) { updater: tx-sender, timestamp: block-height, note: note }) u100) (err u0))
    )
    (ok true)
  )
)

(define-read-only (get-status (ticket-id uint))
  (ok (default-to STATUS_OPEN (map-get? ticket-status ticket-id)))
)

(define-read-only (get-log (ticket-id uint))
  (ok (default-to (list) (map-get? update-logs ticket-id)))
)
```

#### 4. ComplaintDetails.clar
Stores hashed complaint details (e.g., phone model, issue description) linked to NFTs.

```clarity
;; ComplaintDetails Contract
;; Stores off-chain hashed details

(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XzHP9JC3Z0pOPMF9F3G3.TicketNFT.nft-trait)

(define-map complaint-hashes uint (string-ascii 64)) ;; SHA256 hash of details
(define-map complaint-types uint (string-ascii 32)) ;; e.g., "hardware", "billing"

(define-constant ERR-NOT-OWNER u400)

(define-public (set-details (ticket-id uint) (hash (string-ascii 64)) (complaint-type (string-ascii 32)) (nft-contract <nft-trait>))
  (let ((owner (unwrap! (as-contract (contract-call? nft-contract get-owner ticket-id)) (err u0))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
    (map-set complaint-hashes ticket-id hash)
    (map-set complaint-types ticket-id complaint-type)
    (ok true)
  )
)

(define-read-only (get-details-hash (ticket-id uint))
  (ok (map-get? complaint-hashes ticket-id))
)

(define-read-only (get-complaint-type (ticket-id uint))
  (ok (map-get? complaint-types ticket-id))
)
```

#### 5. ResolutionRewards.clar
Manages resolutions and rewards agents/customers with a fungible token (e.g., for good service).

```clarity
;; ResolutionRewards Contract
;; Handles resolutions and token rewards

(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XzHP9JC3Z0pOPMF9F3G3.TicketNFT.nft-trait)
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-map resolutions uint { resolver: principal, reward-amount: uint })
(define-data-var reward-token <ft-trait>)

(define-constant ERR-NOT-RESOLVED u500)
(define-constant DEFAULT_REWARD u100) ;; In token units

(define-public (resolve-ticket (ticket-id uint) (nft-contract <nft-trait>) (token-contract <ft-trait>))
  (begin
    (try! (contract-call? 'SP2PABAF9FTAJYNFZH93XzHP9JC3Z0pOPMF9F3G3.StatusUpdater update-status ticket-id "resolved" "Ticket resolved" nft-contract))
    (map-set resolutions ticket-id { resolver: tx-sender, reward-amount: DEFAULT_REWARD })
    (try! (as-contract (contract-call? token-contract transfer DEFAULT_REWARD tx-sender (unwrap! (as-contract (contract-call? nft-contract get-owner ticket-id)) (err u0)) none)))
    (ok true)
  )
)

(define-read-only (get-resolution (ticket-id uint))
  (ok (map-get? resolutions ticket-id))
)
```

#### 6. IntegrationOracle.clar
A simple oracle for off-chain integrations (e.g., verifying in-store scans). In production, this would connect to external APIs.

```clarity
;; IntegrationOracle Contract
;; Simulates oracle for cross-channel verifications

(define-map oracle-data uint { source: (string-ascii 32), value: (string-ascii 256) }) ;; e.g., source: "in-store", value: "verified"

(define-data-var oracle-owner principal tx-sender)

(define-constant ERR-NOT-ORACLE-OWNER u600)

(define-public (update-oracle (ticket-id uint) (source (string-ascii 32)) (value (string-ascii 256)))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-owner)) (err ERR-NOT-ORACLE-OWNER))
    (map-set oracle-data ticket-id { source: source, value: value })
    (ok true)
  )
)

(define-read-only (get-oracle-data (ticket-id uint))
  (ok (map-get? oracle-data ticket-id))
)
```

## Installation and Deployment

1. Install Clarinet: `cargo install clarinet`
2. Clone repo: `git clone <repo-url>`
3. Test locally: `clarinet test`
4. Deploy to Stacks testnet/mainnet: Use Stacks Explorer or CLI. Update contract principals accordingly.
5. For token rewards, deploy a SIP-010 token contract separately.

## Usage

- **Mint Ticket**: Call `TicketNFT.mint` with customer principal and metadata hash.
- **Register Agent**: Admin calls `AgentRegistry.register-agent`.
- **Update Status**: Agent calls `StatusUpdater.update-status`.
- **Resolve**: Agent calls `ResolutionRewards.resolve-ticket`.
- **Query**: Use read-only functions for tracking.

## Security Notes
- All contracts use assertions for auth.
- No unbounded loops; fixed-size lists.
- Audit recommended before mainnet.

## License
MIT License.