// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VeriFiEscrow
/// @notice On-chain escrow for VeriFi Agents job budgets on Arc testnet.
/// USDC is Arc's native gas-equivalent currency (docs.arc.io/arc/references/
/// contract-addresses), so "locking USDC" is just sending native value to
/// this contract and tracking it per job -- no ERC-20 approve/transferFrom.
/// Only the designated settler (the orchestrator's wallet) can release,
/// finalize, or refund a job -- lock() itself is open to any requester.
contract VeriFiEscrow {
    address public owner;
    address public settler;

    enum JobStatus { None, Locked, Settled, Refunded }

    struct Job {
        address requester;
        uint256 lockedAmount;
        uint256 releasedAmount;
        JobStatus status;
    }

    mapping(bytes32 => Job) public jobs;

    event Locked(bytes32 indexed jobId, address indexed requester, uint256 amount);
    event Released(bytes32 indexed jobId, address indexed provider, uint256 amount, string outcome);
    event Withheld(bytes32 indexed jobId, uint256 amount);
    event Refunded(bytes32 indexed jobId, address indexed requester, uint256 amount);
    event SettlerUpdated(address indexed newSettler);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlySettler() {
        require(msg.sender == settler, "not settler");
        _;
    }

    constructor(address _settler) {
        owner = msg.sender;
        settler = _settler;
    }

    function setSettler(address _settler) external onlyOwner {
        settler = _settler;
        emit SettlerUpdated(_settler);
    }

    /// @notice Requester locks a job's budget. jobId is keccak256 of the
    /// off-chain job_id string so the Python side addresses the same job.
    function lock(bytes32 jobId) external payable {
        require(msg.value > 0, "zero value");
        Job storage j = jobs[jobId];
        require(j.status == JobStatus.None, "job already exists");
        j.requester = msg.sender;
        j.lockedAmount = msg.value;
        j.status = JobStatus.Locked;
        emit Locked(jobId, msg.sender, msg.value);
    }

    /// @notice Settler releases one specialist's payout for a job. Callable
    /// once per specialist per job (the orchestrator calls it per payout
    /// line in settlement/escrow.py).
    function release(bytes32 jobId, address payable provider, uint256 amount, string calldata outcome) external onlySettler {
        Job storage j = jobs[jobId];
        require(j.status == JobStatus.Locked, "job not locked");
        require(j.releasedAmount + amount <= j.lockedAmount, "exceeds locked amount");
        j.releasedAmount += amount;
        (bool ok, ) = provider.call{value: amount}("");
        require(ok, "transfer failed");
        emit Released(jobId, provider, amount, outcome);
    }

    /// @notice Settler closes a job after all releases are done. Any
    /// unreleased balance (withheld for mismatched/unverifiable claims)
    /// simply stays in the contract -- matching the "withheld funds never
    /// leave escrow" semantics of the original off-chain design.
    function finalize(bytes32 jobId) external onlySettler {
        Job storage j = jobs[jobId];
        require(j.status == JobStatus.Locked, "job not locked");
        uint256 withheld = j.lockedAmount - j.releasedAmount;
        j.status = JobStatus.Settled;
        if (withheld > 0) {
            emit Withheld(jobId, withheld);
        }
    }

    /// @notice Settler refunds a job's full remaining locked balance back
    /// to the requester -- used when a job fails before/without any
    /// specialist being paid (e.g. an LLM planning failure).
    function refund(bytes32 jobId) external onlySettler {
        Job storage j = jobs[jobId];
        require(j.status == JobStatus.Locked, "job not locked");
        uint256 remaining = j.lockedAmount - j.releasedAmount;
        j.status = JobStatus.Refunded;
        if (remaining > 0) {
            (bool ok, ) = payable(j.requester).call{value: remaining}("");
            require(ok, "refund failed");
        }
        emit Refunded(jobId, j.requester, remaining);
    }

    function getJob(bytes32 jobId) external view returns (address requester, uint256 lockedAmount, uint256 releasedAmount, JobStatus status) {
        Job storage j = jobs[jobId];
        return (j.requester, j.lockedAmount, j.releasedAmount, j.status);
    }
}
