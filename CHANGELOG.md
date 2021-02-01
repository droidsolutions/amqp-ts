# [2.0.0](https://github.com/droidsolutions/amqp-ts/compare/v1.3.2...v2.0.0) (2021-02-01)


### Code Refactoring

* replac eunused options interface with amqplib interface ([679359c](https://github.com/droidsolutions/amqp-ts/commit/679359c2579d24b00ce3a74773353efe63632f09))


### BREAKING CHANGES

* removes StartConsumerOptions export.
* Queue.activateConsumer and Exchange.activateConsumer now takes the
AmqpLib.Options.Consume interface
instead of the StartConsumerOptions. The interfaces look the same so no special actions should be
needed.

Also adds JSDOC comments on public queue methods and properties.

## [1.3.2](https://github.com/droidsolutions/amqp-ts/compare/v1.3.1...v1.3.2) (2020-11-20)


### Bug Fixes

* export ReconnectStrategy ([c9baa02](https://github.com/droidsolutions/amqp-ts/commit/c9baa0213c3b3068fbcb925f932c682bf46bb41a))

## [1.3.1](https://github.com/droidsolutions/amqp-ts/compare/v1.3.0...v1.3.1) (2020-10-15)


### Bug Fixes

* suppress "content is not a buffer" ([284b492](https://github.com/droidsolutions/amqp-ts/commit/284b492ad4b3cd3491d809fcc01813ef50f224d2))

# [1.3.0](https://github.com/droidsolutions/amqp-ts/compare/v1.2.1...v1.3.0) (2020-09-28)


### Features

* emit jsdoc in transpiled js ([27c5619](https://github.com/droidsolutions/amqp-ts/commit/27c561917999edddc8cbab80e0a9216d11327d85))

## [1.2.1](https://github.com/droidsolutions/amqp-ts/compare/v1.2.0...v1.2.1) (2020-09-28)


### Bug Fixes

* implement AmqpProperties for librrary consumers and add documentation ([e28d535](https://github.com/droidsolutions/amqp-ts/commit/e28d53538a722a89b6c0e7d8884506d686ffe6c3))

# [1.2.0](https://github.com/droidsolutions/amqp-ts/compare/v1.1.1...v1.2.0) (2020-09-28)


### Features

* add generic getJsonContent method to Message ([931d40e](https://github.com/droidsolutions/amqp-ts/commit/931d40eac304e67d9c0bd649495cec301e393563))

## [1.1.1](https://github.com/droidsolutions/amqp-ts/compare/v1.1.0...v1.1.1) (2020-09-28)


### Bug Fixes

* re-export Amqp property type ([2b8b887](https://github.com/droidsolutions/amqp-ts/commit/2b8b887e45b69dcc6da65ef15e944b919fe26022))

# [1.1.0](https://github.com/droidsolutions/amqp-ts/compare/v1.0.3...v1.1.0) (2020-09-28)


### Features

* set type of Message properties ([b7c965c](https://github.com/droidsolutions/amqp-ts/commit/b7c965c64e24fe48ff34010f1089544a8d9e07dd))
* **deps:** update amqplib to 0.6.0 ([8106b1c](https://github.com/droidsolutions/amqp-ts/commit/8106b1c0a2c8bd0dd2afaa3a34156d0c5dc224e7))

## [1.0.3](https://github.com/droidsolutions/amqp-ts/compare/v1.0.2...v1.0.3) (2020-05-25)


### Bug Fixes

* update amqlib to 0.5.6 ([e254676](https://github.com/droidsolutions/amqp-ts/commit/e254676df29b9c8ce7e369bf58ba8c356f99d4bc))

## [1.0.2](https://github.com/droidsolutions/amqp-ts/compare/v1.0.1...v1.0.2) (2020-04-15)


### Bug Fixes

* make message content public again ([8f19be1](https://github.com/droidsolutions/amqp-ts/commit/8f19be18ea0e591308ddfd72dcc5cc955133fa03))
* make properties of Message public again ([7b3b6ef](https://github.com/droidsolutions/amqp-ts/commit/7b3b6efb24944eefa55c447c2573985bbfc4c1e2))
* make type constructor arg for Exchange optional again ([6cbeae5](https://github.com/droidsolutions/amqp-ts/commit/6cbeae5296b4befa907352ff8e8dde77fb254d40))

## [1.0.1](https://github.com/droidsolutions/amqp-ts/compare/v1.0.0...v1.0.1) (2020-04-14)


### Bug Fixes

* add publishConfig to mark to package public ([a97ba95](https://github.com/droidsolutions/amqp-ts/commit/a97ba95b18dc005af88af4e3c60ccf599bb4e867))

# 1.0.0 (2020-04-14)


### Features

* remove winston and add logger factory ([75c5cd1](https://github.com/droidsolutions/amqp-ts/commit/75c5cd131d0c5458e107c62a95d3c344e91bcf6e))
* update amqplib to 0.5.5 ([ffc3d42](https://github.com/droidsolutions/amqp-ts/commit/ffc3d42583a965c4e2e6d313692054c965c3cc95))
