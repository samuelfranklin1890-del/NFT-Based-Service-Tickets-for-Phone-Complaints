;; TicketNFT Contract
;; Sophisticated NFT for service tickets with access control, approvals, and event logging

(define-trait nft-trait
  (
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  )
)

(define-non-fungible-token ticket-nft uint)

(define-map ticket-owners uint principal)
(define-map ticket-metadata uint { hash: (string-ascii 256), description: (string-utf8 500), complaint-type: (string-ascii 32) })
(define-map ticket-status uint (string-ascii 64)) ;; e.g., "open", "in-progress", "resolved"
(define-map update-logs uint (list 50 { updater: principal, timestamp: uint, note: (string-ascii 256) }))
(define-map approvals uint principal) ;; Approved operator for a ticket
(define-map operator-approvals { owner: principal, operator: principal } bool)

(define-data-var last-id uint u0)
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-ID u101)
(define-constant ERR-ALREADY-EXISTS u102)
(define-constant ERR-PAUSED u103)
(define-constant ERR-INVALID-STATUS u104)
(define-constant ERR-NOT-OWNER u105)
(define-constant ERR-MAX-LOGS-REACHED u106)
(define-constant ERR-INVALID-METADATA u107)

(define-constant STATUS_OPEN "open")
(define-constant STATUS_IN_PROGRESS "in-progress")
(define-constant STATUS_RESOLVED "resolved")

(define-constant MAX_METADATA_DESC_LEN u500)
(define-constant MAX_LOG_ENTRIES u50)

;; Event printing function
(define-private (print-event (event-name (string-ascii 32)) (data (string-ascii 256)))
  (print { event: event-name, data: data })
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (print-event "ownership-transfer" (concat "New owner: " (principal-to-string new-owner)))
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set paused true)
    (print-event "contract-paused" "Contract paused")
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set paused false)
    (print-event "contract-unpaused" "Contract unpaused")
    (ok true)
  )
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-public (mint (recipient principal) (metadata-hash (string-ascii 256)) (description (string-utf8 500)) (complaint-type (string-ascii 32)))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> (len description) u0) (err ERR-INVALID-METADATA))
    (asserts! (<= (len description) MAX_METADATA_DESC_LEN) (err ERR-INVALID-METADATA))
    (let ((new-id (+ (var-get last-id) u1)))
      (try! (nft-mint? ticket-nft new-id recipient))
      (map-set ticket-owners new-id recipient)
      (map-set ticket-metadata new-id { hash: metadata-hash, description: description, complaint-type: complaint-type })
      (map-set ticket-status new-id STATUS_OPEN)
      (map-set update-logs new-id (list { updater: tx-sender, timestamp: block-height, note: "Ticket minted" }))
      (var-set last-id new-id)
      (print-event "ticket-minted" (concat "ID: " (uint-to-string new-id)))
      (ok new-id)
    )
  )
)

(define-public (burn (id uint))
  (let ((owner (unwrap! (nft-get-owner? ticket-nft id) (err ERR-INVALID-ID))))
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (or (is-eq tx-sender owner) (is-approved id tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (default-to STATUS_OPEN (map-get? ticket-status id)) STATUS_RESOLVED) (err ERR-INVALID-STATUS))
    (try! (nft-burn? ticket-nft id owner))
    (map-delete ticket-owners id)
    (map-delete ticket-metadata id)
    (map-delete ticket-status id)
    (map-delete update-logs id)
    (map-delete approvals id)
    (print-event "ticket-burned" (concat "ID: " (uint-to-string id)))
    (ok true)
  )
)

(define-read-only (get-owner (id uint))
  (ok (map-get? ticket-owners id))
)

(define-read-only (get-metadata (id uint))
  (ok (map-get? ticket-metadata id))
)

(define-read-only (get-status (id uint))
  (ok (default-to STATUS_OPEN (map-get? ticket-status id)))
)

(define-read-only (get-log (id uint))
  (ok (default-to (list) (map-get? update-logs id)))
)

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-some (nft-get-owner? ticket-nft id)) (err ERR-INVALID-ID))
    (asserts! (is-eq (unwrap-panic (nft-get-owner? ticket-nft id)) sender) (err ERR-NOT-OWNER))
    (try! (nft-transfer? ticket-nft id sender recipient))
    (map-set ticket-owners id recipient)
    (map-delete approvals id) ;; Clear approval on transfer
    (print-event "ticket-transferred" (concat "ID: " (uint-to-string id) " to " (principal-to-string recipient)))
    (ok true)
  )
)

(define-public (approve (id uint) (operator principal))
  (let ((owner (unwrap! (nft-get-owner? ticket-nft id) (err ERR-INVALID-ID))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
    (map-set approvals id operator)
    (print-event "approval-set" (concat "ID: " (uint-to-string id) " approved for " (principal-to-string operator)))
    (ok true)
  )
)

(define-public (revoke-approval (id uint))
  (let ((owner (unwrap! (nft-get-owner? ticket-nft id) (err ERR-INVALID-ID))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
    (map-delete approvals id)
    (print-event "approval-revoked" (concat "ID: " (uint-to-string id)))
    (ok true)
  )
)

(define-read-only (get-approved (id uint))
  (ok (map-get? approvals id))
)

(define-public (set-approval-for-all (operator principal) (approved bool))
  (begin
    (map-set operator-approvals { owner: tx-sender, operator: operator } approved)
    (print-event "operator-approval" (concat "Operator " (principal-to-string operator) " approved: " (bool-to-string approved)))
    (ok true)
  )
)

(define-read-only (is-approved-for-all (owner principal) (operator principal))
  (ok (default-to false (map-get? operator-approvals { owner: owner, operator: operator })))
)

(define-private (is-approved (id uint) (operator principal))
  (or
    (is-eq (unwrap-panic (nft-get-owner? ticket-nft id)) operator)
    (is-some (map-get? approvals id))
    (is-eq (unwrap-panic (map-get? approvals id)) operator)
    (default-to false (map-get? operator-approvals { owner: (unwrap-panic (nft-get-owner? ticket-nft id)), operator: operator }))
  )
)

(define-public (update-status (id uint) (new-status (string-ascii 64)) (note (string-ascii 256)))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-some (nft-get-owner? ticket-nft id)) (err ERR-INVALID-ID))
    (asserts! (or (is-eq tx-sender (unwrap-panic (nft-get-owner? ticket-nft id))) (is-approved id tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (or (is-eq new-status STATUS_OPEN) (is-eq new-status STATUS_IN_PROGRESS) (is-eq new-status STATUS_RESOLVED)) (err ERR-INVALID-STATUS))
    (map-set ticket-status id new-status)
    (let ((current-logs (default-to (list) (map-get? update-logs id))))
      (asserts! (< (len current-logs) MAX_LOG_ENTRIES) (err ERR-MAX-LOGS-REACHED))
      (map-set update-logs id (append current-logs { updater: tx-sender, timestamp: block-height, note: note }))
    )
    (print-event "status-updated" (concat "ID: " (uint-to-string id) " new status: " new-status))
    (ok true)
  )
)

(define-read-only (get-last-id)
  (ok (var-get last-id))
)

;; Helper functions
(define-private (principal-to-string (p principal))
  (unwrap-panic (principal-destruct? p))
)

(define-private (uint-to-string (n uint))
  (unwrap-panic (int-to-ascii? (to-int n)))
)

(define-private (bool-to-string (b bool))
  (if b "true" "false")
)

;; More read-only functions for querying
(define-read-only (get-ticket-details (id uint))
  (let (
    (owner (map-get? ticket-owners id))
    (metadata (map-get? ticket-metadata id))
    (status (map-get? ticket-status id))
    (logs (map-get? update-logs id))
  )
    (ok { owner: owner, metadata: metadata, status: status, logs: logs })
  )
)

(define-read-only (is-valid-ticket (id uint))
  (ok (is-some (nft-get-owner? ticket-nft id)))
)