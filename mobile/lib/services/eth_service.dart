import 'package:web3dart/web3dart.dart';
import 'package:http/http.dart';

import '../config/blockchain_config.dart';
import 'erc20_abi.dart';

class EthService {
  static final Web3Client _client = Web3Client(sepoliaRpcUrl, Client());

  static final EthereumAddress _tokenAddress = EthereumAddress.fromHex(
    dcldTokenAddress,
  );

  static final DeployedContract _contract = DeployedContract(
    ContractAbi.fromJson(erc20Abi, "DCLD"),
    _tokenAddress,
  );

  static final ContractFunction _balanceOf = _contract.function("balanceOf");

  static final ContractFunction _decimals = _contract.function("decimals");

  static Future<double> getTokenBalance(String walletAddress) async {
    final EthereumAddress address = EthereumAddress.fromHex(walletAddress);

    final List<dynamic> balanceResult = await _client.call(
      contract: _contract,
      function: _balanceOf,
      params: [address],
    );

    final List<dynamic> decimalsResult = await _client.call(
      contract: _contract,
      function: _decimals,
      params: [],
    );

    final BigInt rawBalance = balanceResult.first as BigInt;
    final BigInt decimalsBig = decimalsResult.first as BigInt;

    final int decimals = decimalsBig.toInt();
    final BigInt divisor = BigInt.from(10).pow(decimals);

    // ✅ EXPLICIT conversion
    final double balance = rawBalance.toDouble() / divisor.toDouble();

    return balance;
  }
}
