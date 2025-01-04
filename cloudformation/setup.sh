AWS_PROFILE=default
PREFIX=asm3

# Compute resources
aws cloudformation create-stack \
    --stack-name $PREFIX-test-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=test ParameterKey=KeyPair,ParameterValue=khang-key ParameterKey=InstanceProfile,ParameterValue="LabInstanceProfile"\
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-test-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=test ParameterKey=KeyPair,ParameterValue=khang-key ParameterKey=InstanceProfile,ParameterValue="LabInstanceProfile"\
    --profile=$AWS_PROFILE

# Serverless resources
aws cloudformation create-stack \
    --stack-name $PREFIX-serverless-test-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=test \
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-serverless-test-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=test \
    --profile=$AWS_PROFILE

# LabRole replication
aws cloudformation create-stack \
    --stack-name $PREFIX-role-stack \
    --template-body file://role.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --profile=$AWS_PROFILE

# Clean resources
aws cloudformation delete-stack \
    --stack-name $PREFIX-test-compute-stack \
    --profile=$AWS_PROFILE

aws cloudformation delete-stack \
    --stack-name $PREFIX-serverless-test-stack \
    --profile=$AWS_PROFILE

aws cloudformation create-stack \
    --stack-name $PREFIX-lab-role \
    --template-body file://labrole.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --profile=$AWS_PROFILE
