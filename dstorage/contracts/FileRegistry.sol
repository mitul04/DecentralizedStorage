// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FileRegistry {
    struct File {
        address owner;
        string cid;             
        string fileName;        
        string fileType;        
        address[] hosts;        
        uint256 fileSize;       
        uint256 timestamp;
    }

    mapping(string => File) private fileMap;
    
    // 1. NEW: Store a list of CIDs for every user
    mapping(address => string[]) private userFiles; 

    event FileRegistered(string cid, string fileName, address indexed owner);

    function registerFile(
        string memory _cid,
        string memory _fileName,
        string memory _fileType,
        uint256 _fileSize,
        address[] calldata _hosts
    ) external {
        require(fileMap[_cid].owner == address(0), "File already exists");

        fileMap[_cid] = File({
            owner: msg.sender,
            cid: _cid,
            fileName: _fileName,
            fileType: _fileType,
            hosts: _hosts,
            fileSize: _fileSize,
            timestamp: block.timestamp
        });

        // 2. NEW: Add this CID to the user's list
        userFiles[msg.sender].push(_cid);

        emit FileRegistered(_cid, _fileName, msg.sender);
    }

    // 3. NEW: Get all files for the caller
    function getMyFiles() external view returns (File[] memory) {
        string[] memory cids = userFiles[msg.sender];
        File[] memory files = new File[](cids.length);
        
        for (uint i = 0; i < cids.length; i++) {
            files[i] = fileMap[cids[i]];
        }
        return files;
    }

    // Keep the old helper just in case
    function getFile(string memory _cid)
        external
        view
        returns (
            address owner,
            string memory cid,
            string memory fileName,
            string memory fileType,
            uint256 fileSize,
            address[] memory hosts
        )
    {
        File memory f = fileMap[_cid];
        require(f.owner != address(0), "File not found");
        return (f.owner, f.cid, f.fileName, f.fileType, f.fileSize, f.hosts);
    }
}