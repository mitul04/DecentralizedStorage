// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StorageNodeRegistry is Ownable {
    
    IERC20 public rewardToken;
    uint256 public stakeAmount = 500 * 10**18; // 500 Tokens stake required

    // The "Resume" of a Node
    struct NodeProfile {
        string ipAddress;       // e.g., "/ip4/127.0.0.1/tcp/4001"
        uint256 totalCapacity;  // Total space (in bytes)
        uint256 freeCapacity;   // Available space (in bytes)
        uint256 lastHeartbeat;  // Timestamp of last ping
        uint256 reputation;     // Score 0-100
        bool isMobile;          // True = Tier 2 (Mobile), False = Tier 1 (Desktop)
        bool isRegistered;      // Is active?
    }

    mapping(address => NodeProfile) public nodes;
    address[] public nodeList;

    event NodeRegistered(address indexed nodeAddress, bool isMobile, uint256 capacity);
    event HeartbeatReceived(address indexed nodeAddress, uint256 timestamp);
    event CapacityUpdated(address indexed nodeAddress, uint256 newFreeCapacity);
    event IPUpdated(address indexed nodeAddress, string newIp);

    constructor(address _tokenAddress) Ownable(msg.sender) {
        require(_tokenAddress != address(0), "Invalid token address");
        rewardToken = IERC20(_tokenAddress);
    }

    // 1. Register with Capacity & Mobile Status
    function registerNode(string memory _ipAddress, uint256 _totalCapacity, bool _isMobile) external {
        require(!nodes[msg.sender].isRegistered, "Node already registered");

        // Financial Security: Take the Stake
        bool success = rewardToken.transferFrom(msg.sender, address(this), stakeAmount);
        require(success, "Staking failed: Allowance too low or insufficient balance");

        nodes[msg.sender] = NodeProfile({
            ipAddress: _ipAddress,
            totalCapacity: _totalCapacity,
            freeCapacity: _totalCapacity, // Starts empty
            lastHeartbeat: block.timestamp,
            reputation: 100, // Starts perfect
            isMobile: _isMobile,
            isRegistered: true
        });

        nodeList.push(msg.sender);
        emit NodeRegistered(msg.sender, _isMobile, _totalCapacity);
    }

    // Allows a node to update its IP without re-staking tokens
    function updateIpAddress(string memory _newIp) external {
        require(nodes[msg.sender].isRegistered, "Node not registered");
        nodes[msg.sender].ipAddress = _newIp;
        nodes[msg.sender].lastHeartbeat = block.timestamp; // Acts as a ping too!
        emit IPUpdated(msg.sender, _newIp);
    }

    // 2. The "I'm Alive" Pulse (Called daily)
    function ping() external {
        require(nodes[msg.sender].isRegistered, "Node not found");
        nodes[msg.sender].lastHeartbeat = block.timestamp;
        
        // Simple Gamification: Every ping keeps reputation high
        if(nodes[msg.sender].reputation < 100) {
            nodes[msg.sender].reputation += 1; 
        }

        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    // 3. Update Storage (Called when file is added/removed)
    function updateCapacity(uint256 _usedBytes, bool _isAdding) external {
        require(nodes[msg.sender].isRegistered, "Node not found");
        
        if (_isAdding) {
            require(nodes[msg.sender].freeCapacity >= _usedBytes, "Not enough space!");
            nodes[msg.sender].freeCapacity -= _usedBytes;
        } else {
            // Freeing up space
            uint256 newFree = nodes[msg.sender].freeCapacity + _usedBytes;
            if (newFree > nodes[msg.sender].totalCapacity) {
                newFree = nodes[msg.sender].totalCapacity;
            }
            nodes[msg.sender].freeCapacity = newFree;
        }

        emit CapacityUpdated(msg.sender, nodes[msg.sender].freeCapacity);
    }

    function getAllNodes() external view returns (address[] memory) {
        return nodeList;
    }
}