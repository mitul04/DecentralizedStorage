// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// 🚨 Import the Cryptography libraries to verify the Coordinator's signature
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// We need an interface to call the mint function on your RewardToken
interface IRewardToken {
    function mintReward(address to, uint256 amount) external;
}

contract StorageNodeRegistry is Ownable {
    using ECDSA for bytes32;

    IERC20 public rewardToken;
    uint256 public stakeAmount = 500 * 10**18; // 500 Tokens stake required
    
    // 🚨 The designated "Boss" wallet that is allowed to sign paychecks
    address public coordinatorSigner; 

    // 🚨 A ledger to remember which checks have already been cashed
    mapping(bytes => bool) public usedSignatures;

    struct NodeProfile {
        string ipAddress;       
        uint256 totalCapacity;  
        uint256 freeCapacity;   
        uint256 lastHeartbeat;  
        uint256 reputation;     
        bool isMobile;          
        bool isRegistered;      
    }

    mapping(address => NodeProfile) public nodes;
    address[] public nodeList;

    event NodeRegistered(address indexed nodeAddress, bool isMobile, uint256 capacity);
    event HeartbeatReceived(address indexed nodeAddress, uint256 timestamp);
    event CapacityUpdated(address indexed nodeAddress, uint256 newFreeCapacity);
    event IPUpdated(address indexed nodeAddress, string newIp);
    event NodeDeregistered(address indexed nodeAddress);
    event RewardClaimed(address indexed nodeAddress, uint256 amount);

    // 🚨 UPDATED CONSTRUCTOR: Now accepts the Coordinator's Address!
    constructor(address _tokenAddress, address _coordinatorSigner) Ownable(msg.sender) {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_coordinatorSigner != address(0), "Invalid signer address");
        rewardToken = IERC20(_tokenAddress);
        coordinatorSigner = _coordinatorSigner; 
    }

    function registerNode(string memory _ipAddress, uint256 _totalCapacity, bool _isMobile) external {
        require(!nodes[msg.sender].isRegistered, "Node already registered");
        bool success = rewardToken.transferFrom(msg.sender, address(this), stakeAmount);
        require(success, "Staking failed: Allowance too low or insufficient balance");

        nodes[msg.sender] = NodeProfile({
            ipAddress: _ipAddress,
            totalCapacity: _totalCapacity,
            freeCapacity: _totalCapacity, 
            lastHeartbeat: block.timestamp,
            reputation: 100, 
            isMobile: _isMobile,
            isRegistered: true
        });

        nodeList.push(msg.sender);
        emit NodeRegistered(msg.sender, _isMobile, _totalCapacity);
    }

    function updateIpAddress(string memory _newIp) external {
        require(nodes[msg.sender].isRegistered, "Node not registered");
        nodes[msg.sender].ipAddress = _newIp;
        nodes[msg.sender].lastHeartbeat = block.timestamp; 
        emit IPUpdated(msg.sender, _newIp);
    }

    function updateCapacity(uint256 _usedBytes, bool _isAdding) external {
        require(nodes[msg.sender].isRegistered, "Node not found");
        if (_isAdding) {
            require(nodes[msg.sender].freeCapacity >= _usedBytes, "Not enough space!");
            nodes[msg.sender].freeCapacity -= _usedBytes;
        } else {
            uint256 newFree = nodes[msg.sender].freeCapacity + _usedBytes;
            if (newFree > nodes[msg.sender].totalCapacity) {
                newFree = nodes[msg.sender].totalCapacity;
            }
            nodes[msg.sender].freeCapacity = newFree;
        }
        emit CapacityUpdated(msg.sender, nodes[msg.sender].freeCapacity);
    }

    function deregisterNode() external {
        require(nodes[msg.sender].isRegistered, "Node not registered");
        nodes[msg.sender].isRegistered = false;
        bool success = rewardToken.transfer(msg.sender, stakeAmount);
        require(success, "Stake refund failed");
        emit NodeDeregistered(msg.sender);
    }

    function getAllNodes() external view returns (address[] memory) {
        return nodeList;
    }

    // 💰 🚨 THE CRYPTOGRAPHIC PAYCHECK FUNCTION
    function claimDailyReward(uint256 _amount, bytes memory _signature) external {
        // require(nodes[msg.sender].isRegistered, "Node not registered"); // Commented out temporarily if mobile apps aren't "registered" nodes yet, uncomment for strict mode!
        require(!usedSignatures[_signature], "This paycheck has already been cashed!");

        // 1. Recreate the exact message the Coordinator supposedly signed
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, _amount));
        
        // 2. Format it to standard Ethereum signature standards
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

        // 3. Decrypt the signature to see WHO actually signed it
        address recoveredSigner = ethSignedMessageHash.recover(_signature);

        // 4. Verification: Was it our trusted Coordinator?
        require(recoveredSigner == coordinatorSigner, "Fraud detected: Invalid signature!");

        // 5. Mark check as cashed
        usedSignatures[_signature] = true;

        // 6. Pay the node!
        IRewardToken(address(rewardToken)).mintReward(msg.sender, _amount);

        emit RewardClaimed(msg.sender, _amount);
    }
}