// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FileRegistry {
    struct File {
        address owner;
        string cid;              
        string fileName;        
        string fileType;               
        uint256 fileSize;        
        uint256 timestamp;
        uint256 targetReplication;
        address[] hosts;      // Nodes storing it
        address[] sharedWith; // 🆕 List of people who received this file
    }

    mapping(string => File) private fileMap;
    
    // 1. Store a list of CIDs for every user (Uploaded)
    mapping(address => string[]) private userFiles; 

    // 2. Store a list of CIDs shared WITH a user (Received)
    mapping(address => string[]) private sharedFiles;

    event FileRegistered(string cid, string fileName, address indexed owner);
    event FileShared(string cid, address indexed from, address indexed to); // 🆕 Event

    function registerFile(
        string memory _cid,
        string memory _fileName,
        string memory _fileType,
        uint256 _fileSize,
        address[] calldata _hosts,
        uint256 _targetReplication
    ) external {
        require(fileMap[_cid].owner == address(0), "File already exists");

        // Initialize empty address array for sharedWith
        address[] memory emptyShared;

        fileMap[_cid] = File({
            owner: msg.sender,
            cid: _cid,
            fileName: _fileName,
            fileType: _fileType,
            hosts: _hosts,
            fileSize: _fileSize,
            timestamp: block.timestamp,
            targetReplication: _targetReplication,
            sharedWith: emptyShared // Initialize empty
        });

        userFiles[msg.sender].push(_cid);

        emit FileRegistered(_cid, _fileName, msg.sender);
    }

    // --- SHARE FUNCTION ---
    function shareFile(string memory _cid, address _recipient) external {
        require(fileMap[_cid].owner == msg.sender, "Only owner can share");
        require(_recipient != address(0), "Invalid recipient");

        // 1. Add recipient to the file's access list
        fileMap[_cid].sharedWith.push(_recipient);

        // 2. Add file to the recipient's "Inbox"
        sharedFiles[_recipient].push(_cid);

        emit FileShared(_cid, msg.sender, _recipient);
    }

    // --- GETTERS ---

    // Get files I UPLOADED (Sent)
    function getMyFiles() external view returns (File[] memory) {
        string[] memory cids = userFiles[msg.sender];
        File[] memory files = new File[](cids.length);
        
        for (uint i = 0; i < cids.length; i++) {
            files[i] = fileMap[cids[i]];
        }
        return files;
    }

    // Get files SHARED WITH ME (Received)
    function getSharedFiles() external view returns (File[] memory) {
        string[] memory cids = sharedFiles[msg.sender];
        File[] memory files = new File[](cids.length);
        
        for (uint i = 0; i < cids.length; i++) {
            files[i] = fileMap[cids[i]];
        }
        return files;
    }

    // Helper for single file details
    function getFile(string memory _cid)
        external
        view
        returns (
            address owner,
            string memory cid,
            string memory fileName,
            string memory fileType,
            uint256 fileSize,
            address[] memory hosts,
            address[] memory sharedWith // Return shared list too
        )
    {
        File memory f = fileMap[_cid];
        require(f.owner != address(0), "File not found");
        return (f.owner, f.cid, f.fileName, f.fileType, f.fileSize, f.hosts, f.sharedWith);
    }
}